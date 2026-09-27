/**
 * Les candidatures qui attendent une décision SANS fiche pour la prendre.
 *
 * C'est le « sens A » de la divergence file ↔ analyse
 * (`docs/ops/diagnostic-validations-orphelines-2026-09-20.md`) : le dossier
 * porte « À valider », il est compté, et il n'est pas décidable.
 *
 * ⚠️ Cette sélection est PARTAGÉE entre le signal qui les COMPTE et le geste
 * qui les RÉPARE. Deux sélections parallèles finiraient par diverger, et la
 * divergence serait de la pire espèce : un bouton qui répare onze dossiers
 * pendant que le compteur en annonce douze, sans que rien ne l'explique.
 *
 * Bornée par construction : deux zones d'attente, jamais tranchée par un
 * humain, jamais classée sans suite. Lecture exhaustive (keyset interne),
 * rapprochement par `uid` comme partout ailleurs.
 */

import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { checkValidationCoherence, queueMismatch } from '@/lib/hitl/queue-coherence';
import type { DecisionZone } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

const ZONES_EN_ATTENTE: DecisionZone[] = ['gray', 'proposed_reject'];

export async function listAwaitingWithoutRow(): Promise<
  CandidateAnalysisSummary[]
> {
  const batches = await Promise.all(
    ZONES_EN_ATTENTE.map((zone) =>
      listAllCandidateAnalyses({
        decisionZone: zone,
        decidedBy: 'auto',
        dismissed: false,
      }).catch(() => []),
    ),
  );

  const openRows = await listPendingValidations().catch(() => []);
  const openUids = new Set(
    openRows
      .map((v) => (typeof v.payload?.uid === 'string' ? v.payload.uid : null))
      .filter((u): u is string => u !== null),
  );

  return batches.flat().filter(
    (a) =>
      queueMismatch({
        coherence: checkValidationCoherence({
          decisionZone: a.decisionZone,
          decidedBy: a.decidedBy,
          dismissedAt: a.dismissedAt,
        }),
        hasOpenRow: openUids.has(a.uid),
      }) === 'awaiting_without_row',
  );
}
