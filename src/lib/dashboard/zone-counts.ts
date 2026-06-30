/**
 * Comptage EXHAUSTIF de la répartition par décision (Bureau « Process First »).
 *
 * ROBUSTE aux `decision_zone` mal étiquetées (le piège connu : zone re-dérivée
 * du statut sur des analyses anciennes → un gris apparaît `auto_reject`). On NE
 * dépend donc PAS de `decision_zone` mais des signaux FIABLES :
 *   - `status` + `decided_by` sur `candidate_analyses` (count exacts) ;
 *   - la file `pending_validations` (status='pending') = vérité de l'app pour
 *     « en attente de validation » (même source que le menu « À valider »).
 *
 * Partition (somme = total des analyses) :
 *   - En attente            = file pending (gris pas encore tranchés)
 *   - Validés par un humain  = decided_by='user' (gris tranchés, accept OU refus)
 *   - Acceptés automatiquement = status accepted hors décision humaine
 *   - Refusés automatiquement  = status rejected hors décision humaine ET hors
 *     file (les gris en attente ont un statut 'rejected' PROVISOIRE → on les retire)
 */

import { countCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { type ZoneCounts } from '@/lib/dashboard/derive-metrics';

/** Combinaison PURE des comptes bruts → 4 zones. Testable (clamps inclus). */
export function combineZoneCounts(raw: {
  acceptedTotal: number;
  rejectedTotal: number;
  humanAccepted: number;
  humanRejected: number;
  pending: number;
}): ZoneCounts {
  const humanValidated = raw.humanAccepted + raw.humanRejected;
  const autoAccept = Math.max(0, raw.acceptedTotal - raw.humanAccepted);
  // Les gris EN ATTENTE ont status='rejected' provisoire + decided_by='auto' :
  // on les retire des refus AUTO (sinon double compte / refus auto gonflé).
  const autoReject = Math.max(0, raw.rejectedTotal - raw.humanRejected - raw.pending);
  return {
    autoReject,
    autoAccept,
    humanValidated,
    pending: raw.pending,
    total: raw.acceptedTotal + raw.rejectedTotal,
  };
}

export async function zoneDistribution(): Promise<ZoneCounts> {
  const [acceptedTotal, rejectedTotal, humanAccepted, humanRejected, pendingList] =
    await Promise.all([
      countCandidateAnalyses({ status: 'accepted' }),
      countCandidateAnalyses({ status: 'rejected' }),
      countCandidateAnalyses({ status: 'accepted', decidedBy: 'user' }),
      countCandidateAnalyses({ status: 'rejected', decidedBy: 'user' }),
      listPendingValidations().catch(() => []),
    ]);
  return combineZoneCounts({
    acceptedTotal,
    rejectedTotal,
    humanAccepted,
    humanRejected,
    pending: pendingList.length,
  });
}
