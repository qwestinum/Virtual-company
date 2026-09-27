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
 *   - existante `pending` → on RAFRAÎCHIT les seuls champs de la remise en
 *     file (`ENQUEUE_REFRESHABLE`) ; un lien d'artefact non-null déjà posé
 *     n'est jamais remplacé par null. Tout le reste appartient à la fiche
 *     existante — `createdAt` (date de première réception) et, surtout, ce que
 *     l'HUMAIN y a posé.
 *
 * ⚠️ DÉCISION HUMAINE (27/09/2026). Une remise en file ne décide rien : sa
 * direction est PROVISOIRE (`provisionalDecisionFor` ⇒ toujours `reject` pour
 * une fiche). Elle réécrivait pourtant `decision`, `confirmed` et l'auteur
 * sur une fiche encore `pending` : un recruteur qui venait de choisir
 * « accepter » (PATCH, puis réservation quelques millisecondes plus tard)
 * voyait sa fiche repasser à « refuser » entre les deux — l'invitation
 * partait (le mail suit l'écran), mais la finalisation lisait la base :
 * analyse refusée, lien de réservation révoqué. Attrapé par la régression S4
 * (le filet serveur du dépôt de CV tombait dans la fenêtre). La même règle
 * vaut au niveau de la REQUÊTE (`enqueueRefreshRow`) : une lecture qui décide
 * ne suffit pas, un PATCH peut arriver entre elle et l'écriture.
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
      ...existing,
      ...pickRefreshable(fresh),
      cvArtifactId: fresh.cvArtifactId ?? existing.cvArtifactId,
      reportArtifactId: fresh.reportArtifactId ?? existing.reportArtifactId,
    },
  };
}

/**
 * Les SEULS champs qu'une remise en file (réessai IMAP, rejeu, filet serveur,
 * re-scoring, re-mise en file manuelle) écrit sur une fiche qui existe déjà :
 * ce que l'analyse sait du dossier. Jamais la décision, la confirmation,
 * l'auteur, le brouillon (il suit la décision), le statut ni la date de
 * première réception.
 */
export const ENQUEUE_REFRESHABLE = [
  'campaignId',
  'candidateName',
  'candidateEmail',
  'score',
  'cvArtifactId',
  'reportArtifactId',
  'payload',
  'updatedAt',
] as const satisfies readonly (keyof PendingValidation)[];

export type EnqueueRefresh = Pick<PendingValidation, (typeof ENQUEUE_REFRESHABLE)[number]>;

export function pickRefreshable(v: PendingValidation): EnqueueRefresh {
  return {
    campaignId: v.campaignId,
    candidateName: v.candidateName,
    candidateEmail: v.candidateEmail,
    score: v.score,
    cvArtifactId: v.cvArtifactId,
    reportArtifactId: v.reportArtifactId,
    payload: v.payload,
    updatedAt: v.updatedAt,
  };
}
