/**
 * Candidatures issues du vivier dans le rapport de campagne (point 1 bis) —
 * PUR. « dont N issues du vivier » à côté de Reçues, et la conversion des
 * invitations lancées depuis la campagne : ont réservé / invités.
 */
import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import { isVivierAnalysisId } from '@/lib/vivier/origin';

export type VivierOriginCounts = {
  /** Candidatures d'origine vivier (invitées depuis la campagne OU rapprochées). */
  received: number;
  /** Invitées depuis la campagne (« Inviter » dans le vivier). */
  invited: number;
  /** Parmi elles, celles qui ont réservé un entretien. */
  booked: number;
};

/**
 * Une étape atteinte APRÈS une réservation. « Non retenu » en fait partie :
 * il se pose après entretien (ou absence, qui suppose un rendez-vous pris).
 * « Sans suite » n'en fait pas partie : on ne sait pas s'il y a eu réservation.
 */
const BOOKED_STAGES: ReadonlySet<CandidateStage> = new Set([
  'rdv_pris',
  'entretien_fait',
  'retenu',
  'recrute',
  'non_retenu',
]);

export function countVivierOrigin(
  analyses: readonly { id: string; fromVivier: boolean }[],
  stageOf: (id: string) => CandidateStage | null,
): VivierOriginCounts | null {
  let received = 0;
  let invited = 0;
  let booked = 0;
  for (const a of analyses) {
    if (!a.fromVivier && !isVivierAnalysisId(a.id)) continue;
    received += 1;
    if (!isVivierAnalysisId(a.id)) continue;
    invited += 1;
    const stage = stageOf(a.id);
    if (stage && BOOKED_STAGES.has(stage)) booked += 1;
  }
  return received > 0 ? { received, invited, booked } : null;
}
