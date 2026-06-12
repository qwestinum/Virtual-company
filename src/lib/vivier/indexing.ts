/**
 * Service d'indexation du vivier (Session V1, docs/specs/vivier.md §3.2/3.3).
 *
 * `indexVivierCandidate` génère l'embedding sémantique, extrait les entités
 * structurées et met à jour le statut du dossier. IDEMPOTENT : ré-exécutable
 * sans effet de bord (recalcul + upsert dans les tables 1-1, statut repositionné).
 *
 * Hiérarchie des échecs :
 *   - EMBEDDING = critique. S'il échoue, le dossier passe `failed` (re-tentable
 *     manuellement ou via le script de réindexation) et l'indexation s'arrête :
 *     un dossier `pending`/`failed` est EXCLU de toute recherche (garantie
 *     consommée par la présélection V2).
 *   - ENTITÉS = enrichissement non bloquant. Si leur extraction échoue (quelle
 *     qu'en soit la cause), on persiste des entités vides et on marque tout de
 *     même `indexed` dès lors que l'embedding a réussi.
 *
 * Server-only. Conçu pour être déclenché en tâche de fond (`after()` côté route)
 * APRÈS la réponse — il ne bloque jamais le chemin d'appel utilisateur.
 */

import { extractVivierEntities } from '@/lib/vivier/entity-extraction';
import { buildVivierProfileText } from '@/lib/vivier/profile-text';
import { embedText } from '@/lib/ai/embeddings';
import {
  getVivierCandidate,
  setVivierIndexingStatus,
  upsertVivierEmbedding,
  upsertVivierEntities,
} from '@/lib/db/repos/vivier';
import { EMPTY_VIVIER_ENTITIES, type VivierIndexingStatus } from '@/types/vivier';

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

  // Garantie de résilience : TOUTE exception du pipeline d'indexation (échec
  // d'embedding, dimension de vecteur incompatible avec la colonne, échec
  // d'upsert embedding/entités, panne base sur la transition de statut…) repose
  // le dossier en `failed` — re-tentable, JAMAIS laissé `pending` en silence.
  // Le contrat « pending/failed exclus des recherches, failed re-tentable »
  // (§3.2/4.2) est ainsi tenu sans trou.
  try {
    // 1. Entités structurées D'ABORD. Un échec d'EXTRACTION (LLM/transport)
    // reste non bloquant : entités vides, on poursuit. Un échec d'écriture base
    // remonte au catch global (cohérence). Elles alimentent aussi le profil
    // embeddé ci-dessous.
    let entities = { ...EMPTY_VIVIER_ENTITIES };
    try {
      // Contexte d'extraction = nom de fichier d'origine (jamais l'id technique
      // du dossier). Fallback chaîne vide si non persisté.
      entities = await extractVivierEntities(cvText, candidate.cvFileName ?? '');
    } catch (err) {
      console.error(`[vivier] entity extraction failed for ${candidateId}`, err);
    }
    await upsertVivierEntities(candidateId, entities);

    // 2. Embedding sémantique (critique) du PROFIL DISTILLÉ — PAS du CV brut
    // entier. La "forme" d'un CV complet (document long) n'est pas comparable à
    // la requête courte de présélection ⇒ similarités tassées, peu
    // discriminantes. Le profil (tête de CV + relevé d'entités) aligne les deux
    // espaces et rend la similarité pertinente (cf. correctif de pertinence).
    const embedding = await embedText(buildVivierProfileText(entities, cvText));
    await upsertVivierEmbedding(candidateId, {
      vector: embedding.vector,
      provider: embedding.provider,
      model: embedding.model,
    });

    // 3. Succès : le dossier devient recherchable.
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
