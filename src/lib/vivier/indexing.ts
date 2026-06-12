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

import { runKeywordVariantsSuggestion } from '@/lib/agents/server/keyword-variants-execute';
import { extractVivierEntities } from '@/lib/vivier/entity-extraction';
import { embedText } from '@/lib/ai/embeddings';
import {
  getVivierCandidate,
  setVivierIndexingStatus,
  setVivierTitle,
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
    const { entities, title } = await extractVivierEntities(
      cvText,
      candidate.cvFileName ?? '',
    );
    await upsertVivierEntities(candidateId, entities);

    // 2. Variantes du titre (LLM, NON bloquant : échec ⇒ variantes vides, le
    // candidat reste rapprochable par l'embedding titre-à-titre).
    let variants: string[] = [];
    if (title) {
      try {
        const r = await runKeywordVariantsSuggestion({
          criterionLabel: title,
          existingKeywords: [],
          targetMethod: 'keywords_with_variants',
        });
        variants = r.suggestedVariants;
      } catch (err) {
        console.error(`[vivier] title variants failed for ${candidateId}`, err);
      }
    }
    await setVivierTitle(candidateId, title, variants);

    // 3. Embedding du TITRE seul (NON bloquant). PAS d'embedding full-CV.
    if (title) {
      try {
        const emb = await embedText(title);
        await upsertVivierTitleEmbedding(candidateId, {
          vector: emb.vector,
          provider: emb.provider,
          model: emb.model,
        });
      } catch (err) {
        console.error(`[vivier] title embedding failed for ${candidateId}`, err);
      }
    }

    // 4. Succès : le dossier devient recherchable.
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
