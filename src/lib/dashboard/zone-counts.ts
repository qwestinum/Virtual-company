/**
 * Comptage EXHAUSTIF de la répartition par décision (Bureau « Process First »).
 *
 * ROBUSTE aux `decision_zone` mal étiquetées (le piège connu : zone re-dérivée
 * du statut sur des analyses anciennes → un gris apparaît `auto_reject`). On NE
 * dépend donc PAS de `decision_zone` mais des signaux FIABLES :
 *   - `status` + `decided_by` sur `candidate_analyses` (count exacts) ;
 *   - la file `pending_validations` RAPPROCHÉE PAR UID des analyses rejetées —
 *     jamais sa longueur brute. Une ligne de file ORPHELINE (analyse jamais
 *     persistée — incohérence prod 26/07/2026 : Bureau 2 vs menu 4) faisait
 *     sur-soustraire le refus auto et gonflait « en attente ». Même règle de
 *     rapprochement que le menu Candidatures (`stage-signals.ts`) : les deux
 *     surfaces racontent le même chiffre.
 *
 * Partition (somme = total des analyses) :
 *   - En attente            = gris en file ET rapprochés d'une analyse rejetée
 *   - Validés par un humain  = decided_by='user' (gris tranchés, accept OU refus)
 *   - Acceptés automatiquement = status accepted hors décision humaine
 *   - Refusés automatiquement  = status rejected hors décision humaine ET hors
 *     file (les gris en attente ont un statut 'rejected' PROVISOIRE → on les retire)
 */

import { countCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { chunk } from '@/lib/db/paginate';
import { type ZoneCounts } from '@/lib/dashboard/derive-metrics';

/** Combinaison PURE des comptes bruts → 4 zones. Testable (clamps inclus). */
export function combineZoneCounts(raw: {
  acceptedTotal: number;
  rejectedTotal: number;
  humanAccepted: number;
  humanRejected: number;
  /** Gris en file RAPPROCHÉS d'une analyse rejetée (jamais la file brute). */
  pendingMatched: number;
}): ZoneCounts {
  const humanValidated = raw.humanAccepted + raw.humanRejected;
  const autoAccept = Math.max(0, raw.acceptedTotal - raw.humanAccepted);
  // Les gris EN ATTENTE ont status='rejected' provisoire + decided_by='auto' :
  // on les retire des refus AUTO (sinon double compte / refus auto gonflé).
  const autoReject = Math.max(
    0,
    raw.rejectedTotal - raw.humanRejected - raw.pendingMatched,
  );
  return {
    autoReject,
    autoAccept,
    humanValidated,
    pending: raw.pendingMatched,
    total: raw.acceptedTotal + raw.rejectedTotal,
  };
}

/**
 * Compte les analyses REJETÉES dont l'uid figure dans la file HITL — le
 * « en attente » vu depuis les analyses (pas depuis la file). Chunké pour
 * rester sous le cap PostgREST quel que soit le volume de la file.
 *
 * Les analyses DÉJÀ tranchées par un humain sont EXCLUES du rapproché : elles
 * appartiennent à « Validés par un humain » — les compter aussi « en attente »
 * les soustrayait DEUX fois du refus auto (double décompte observé sur des
 * lignes legacy où la validation était restée `pending` après décision,
 * séquelle de l'incident de re-analyses 07/2026).
 */
async function countPendingMatched(uids: string[]): Promise<number> {
  let matched = 0;
  for (const part of chunk(uids, 300)) {
    const [all, human] = await Promise.all([
      countCandidateAnalyses({ status: 'rejected', uidIn: part }),
      countCandidateAnalyses({ status: 'rejected', uidIn: part, decidedBy: 'user' }),
    ]);
    matched += Math.max(0, all - human);
  }
  return matched;
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
  const pendingUids = [
    ...new Set(
      pendingList
        .map((v) => (typeof v.payload?.uid === 'string' ? v.payload.uid : null))
        .filter((u): u is string => u !== null),
    ),
  ];
  const pendingMatched = await countPendingMatched(pendingUids);
  return combineZoneCounts({
    acceptedTotal,
    rejectedTotal,
    humanAccepted,
    humanRejected,
    pendingMatched,
  });
}
