/**
 * Service d'indexation du vivier (docs/specs/vivier.md §3 + refonte titre §4).
 *
 * `indexVivierCandidate` extrait les entités + le TITRE du candidat, génère les
 * variantes du titre (LLM) et l'embedding du TITRE, et met à jour le statut.
 * IDEMPOTENT.
 *
 * Refonte présélection : on N'EMBEDDE PLUS le CV brut/entier. La présélection se
 * fonde sur le TITRE (matching déterministe via variantes + similarité
 * titre-à-titre). L'embedding full-CV n'est plus régénéré.
 *
 * Hiérarchie des échecs :
 *   - EXTRACTION transport (AIProviderError) ou échec d'écriture base = critique
 *     ⇒ dossier `failed`, re-tentable. (AIValidationError ⇒ entités vides + titre
 *     null, non bloquant.)
 *   - VARIANTES et EMBEDDING TITRE = non bloquants : un échec laisse le candidat
 *     `indexed` (rapprochable par l'autre signal — variantes ⇄ embedding titre).
 *   - Titre vide ⇒ pas de variantes ni d'embedding titre : le candidat ne
 *     ressortira pas de la présélection titre (sans erreur).
 *
 * Server-only. Déclenché en tâche de fond — ne bloque jamais l'appelant.
 */

import { runTitleVariantsSuggestion } from '@/lib/agents/server/title-variants-execute';
import { extractVivierEntities } from '@/lib/vivier/entity-extraction';
import { buildAnchorSkeletons } from '@/lib/vivier/title-anchors';
import { splitTitleIntoBlocks } from '@/lib/vivier/title-splitting';
import { embedText } from '@/lib/ai/embeddings';
import {
  getVivierCandidate,
  listDistinctEmbeddingModels,
  replaceSkillEmbeddings,
  setVivierIndexingStatus,
  setVivierSkills,
  setVivierTitle,
  setVivierTitleAnchors,
  upsertVivierTitleEmbedding,
  upsertVivierEntities,
} from '@/lib/db/repos/vivier';
import type { VivierIndexingStatus } from '@/types/vivier';

export type IndexVivierResult = {
  status: VivierIndexingStatus;
  /** Motif en cas d'échec (embedding), sinon null. */
  error: string | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Garde-fou d'espace d'embeddings CÔTÉ PRODUCTEUR. La présélection (chemin de
 * REQUÊTE) refuse déjà un index incohérent (`embedding_model_mismatch`), mais ce
 * refus n'arrive qu'au moment d'une recherche : l'indexation, elle, peut écrire
 * un vecteur dans un espace incompatible (env figé au boot d'un processus pendant
 * qu'un autre a changé de modèle — cf. reindex vs serveur dev) SANS rien signaler.
 * Le mélange s'accumule alors en silence jusqu'à la première présélection.
 *
 * On transforme ce silence en alerte AU MOMENT où le mélange se crée : juste
 * après l'écriture, si un AUTRE couple (provider|model) coexiste déjà dans l'index,
 * on émet un avertissement fort. NON bloquant et tolérant aux pannes (un échec de
 * lecture ne doit jamais compromettre l'indexation) : c'est un signal, pas un
 * verrou. La correction reste un reindex COMPLET + redémarrage de tous les
 * producteurs avec le même `OPENAI_EMBEDDING_MODEL`.
 */
async function warnIfEmbeddingSpaceMixed(
  candidateId: string,
  writtenKey: string,
): Promise<void> {
  try {
    const keys = await listDistinctEmbeddingModels();
    const others = keys.filter((k) => k !== writtenKey);
    if (others.length > 0) {
      console.warn(
        `[vivier] ESPACE D'EMBEDDINGS INCOHÉRENT après indexation de ${candidateId} : ` +
          `ce dossier a été indexé avec « ${writtenKey} » alors que l'index contient ` +
          `aussi « ${others.join(', ')} ». La présélection refusera ce vivier ` +
          `(embedding_model_mismatch). Réindexez COMPLÈTEMENT (npm run reindex:vivier) ` +
          `et redémarrez TOUS les producteurs (serveur + poller) avec le même OPENAI_EMBEDDING_MODEL.`,
      );
    }
  } catch (err) {
    // Lecture best-effort : ne jamais faire échouer l'indexation pour un diagnostic.
    console.error(`[vivier] contrôle d'espace d'embeddings indisponible pour ${candidateId}`, err);
  }
}

/**
 * (Ré)indexe un dossier du vivier. Ne lève jamais sur un échec d'embedding ou
 * d'entités (il les matérialise via le statut) ; une erreur d'accès base
 * inattendue peut en revanche remonter à l'appelant (loggée côté route).
 */
export async function indexVivierCandidate(
  candidateId: string,
): Promise<IndexVivierResult> {
  const candidate = await getVivierCandidate(candidateId);
  if (!candidate) {
    // Dossier supprimé entre-temps : rien à indexer.
    return { status: 'failed', error: 'Dossier introuvable.' };
  }

  const cvText = candidate.cvText?.trim() ?? '';
  if (!cvText) {
    const msg = 'CV sans texte exploitable.';
    await setVivierIndexingStatus(candidateId, 'failed', msg);
    return { status: 'failed', error: msg };
  }

  // Garantie de résilience : une exception d'EXTRACTION (transport) ou
  // d'écriture base repose le dossier en `failed` (re-tentable, jamais `pending`
  // en silence). Variantes + embedding titre sont non bloquants.
  try {
    // 1. Entités + TITRE (un seul appel LLM). AIValidationError ⇒ entités vides
    // + titre null (déjà géré dans extractVivierEntities) ; AIProviderError
    // (transport) ⇒ remonte au catch global (failed, re-tentable).
    const { entities, title, skills, recentPositions } =
      await extractVivierEntities(cvText, candidate.cvFileName ?? '');
    await upsertVivierEntities(candidateId, entities);

    // 2. Variantes du titre déclaré — ISO-RÔLE anglais, par BLOC + titre complet
    // (titres composés), NON bloquant : échec ⇒ variantes vides, le candidat reste
    // rapprochable par l'embedding titre-à-titre.
    let variants: string[] = [];
    if (title) {
      try {
        const r = await runTitleVariantsSuggestion(splitTitleIntoBlocks(title));
        variants = r.variants;
      } catch (err) {
        console.error(`[vivier] title variants failed for ${candidateId}`, err);
      }
    }
    await setVivierTitle(candidateId, title, variants);

    // 2b. ANCRES de titre (Bloc 1 multi-ancres) : titre déclaré (depth 0, réutilise
    // `variants`) + 2 derniers postes (depth 1/2, variantes générées). NON bloquant :
    // échec ⇒ ancres vides ⇒ repli sur le titre déclaré en présélection.
    try {
      const skeletons = buildAnchorSkeletons(title, recentPositions);
      const anchors = [];
      for (const sk of skeletons) {
        let anchorVariants = variants; // depth 0 : déjà calculées
        if (sk.depth !== 0) {
          try {
            anchorVariants = (await runTitleVariantsSuggestion(sk.blocks)).variants;
          } catch (err) {
            console.error(`[vivier] anchor variants failed for ${candidateId}`, err);
            anchorVariants = [];
          }
        }
        const seen = new Set<string>();
        const terms: string[] = [];
        for (const t of [...sk.blocks, ...anchorVariants]) {
          const k = t.trim().toLowerCase();
          if (k && !seen.has(k)) {
            seen.add(k);
            terms.push(t.trim());
          }
        }
        anchors.push({ text: sk.text, depth: sk.depth, terms });
      }
      await setVivierTitleAnchors(candidateId, anchors);
    } catch (err) {
      console.error(`[vivier] title anchors failed for ${candidateId}`, err);
    }

    // 3. Embedding du TITRE seul (NON bloquant). PAS d'embedding full-CV.
    if (title) {
      try {
        const emb = await embedText(title);
        await upsertVivierTitleEmbedding(candidateId, {
          vector: emb.vector,
          provider: emb.provider,
          model: emb.model,
        });
        // Détecte un mélange d'espaces dès qu'il est créé (côté producteur).
        await warnIfEmbeddingSpaceMixed(candidateId, `${emb.provider}|${emb.model}`);
      } catch (err) {
        console.error(`[vivier] title embedding failed for ${candidateId}`, err);
      }
    }

    // 4. Compétences : liste atomique + UN embedding par compétence (set-to-set).
    // NON bloquant : un échec laisse skills/embeddings vides ⇒ couverture 0 en
    // présélection (dégradation douce, le titre porte seul le rapprochement).
    try {
      await setVivierSkills(candidateId, skills);
      if (skills.length > 0) {
        const embedded = await Promise.all(
          skills.map(async (skill) => {
            const emb = await embedText(skill);
            return {
              skill,
              vector: emb.vector,
              provider: emb.provider,
              model: emb.model,
            };
          }),
        );
        await replaceSkillEmbeddings(candidateId, embedded);
      } else {
        await replaceSkillEmbeddings(candidateId, []);
      }
    } catch (err) {
      console.error(`[vivier] skill embeddings failed for ${candidateId}`, err);
    }

    // 5. Succès : le dossier devient recherchable.
    await setVivierIndexingStatus(candidateId, 'indexed', null);
    return { status: 'indexed', error: null };
  } catch (err) {
    const msg = errorMessage(err);
    try {
      await setVivierIndexingStatus(candidateId, 'failed', msg);
    } catch (statusErr) {
      // Même la transition `failed` peut échouer (base injoignable) : on loggue,
      // le dossier reste re-tentable via le script de réindexation.
      console.error(`[vivier] could not mark ${candidateId} failed`, statusErr);
    }
    return { status: 'failed', error: msg };
  }
}
