/**
 * Merge NON DESTRUCTIF d'un enqueue de validation suspendue (HITL).
 *
 * Un enqueue est un UPSERT par id déterministe : une re-passe du même message
 * (retry des rails IMAP, re-analyse) re-enqueue la même validation. Sans
 * garde, la re-passe ÉCRASAIT l'état durable avec ses valeurs fraîches —
 * deux pertes observées en prod (incident 07/2026, uids 1625-1627) :
 *   1. `cvArtifactId` non-null remplacé par null (la re-passe avait raté la
 *      persistance du CV) → la carte de validation perdait le bouton CV ;
 *   2. une validation déjà `sent` (humain a tranché, mail parti) remise à
 *      `pending` → la décision ré-ouverte, en contradiction avec
 *      l'immuabilité de la décision dès réservation (audit C6).
 *
 * Règles (pures, testées) :
 *   - pas de ligne existante → on écrit la fraîche telle quelle ;
 *   - existante non-`pending` (`sending`/`sent`) → on N'ÉCRIT RIEN (la
 *     validation est déjà engagée/tranchée — l'enqueue est un no-op réussi) ;
 *   - existante `pending` → on ré-écrit la fraîche MAIS un lien d'artefact
 *     non-null déjà posé n'est jamais remplacé par null, et `createdAt`
 *     d'origine est conservé (date de première réception, pas de la re-passe).
 */
import type { PendingValidation } from '@/types/hitl';

export type EnqueueMergeResult =
  | { write: true; value: PendingValidation }
  | { write: false; reason: 'already_engaged' };

export function mergePendingValidationEnqueue(
  existing: PendingValidation | null,
  fresh: PendingValidation,
): EnqueueMergeResult {
  if (!existing) return { write: true, value: fresh };
  if (existing.status !== 'pending') {
    return { write: false, reason: 'already_engaged' };
  }
  return {
    write: true,
    value: {
      ...fresh,
      cvArtifactId: fresh.cvArtifactId ?? existing.cvArtifactId,
      reportArtifactId: fresh.reportArtifactId ?? existing.reportArtifactId,
      mailDraftArtifactId:
        fresh.mailDraftArtifactId ?? existing.mailDraftArtifactId,
      createdAt: existing.createdAt,
    },
  };
}
