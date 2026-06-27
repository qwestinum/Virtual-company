/**
 * Projette une analyse persistée + ses signaux de parcours en `CampaignAnalysisDatum`
 * (donnée aplatie consommée par les agrégations). Mutualisé entre la liste des
 * campagnes, le rapport de campagne et le rapport multi-campagnes — évite la
 * triple duplication de la dérivation parcours → datum.
 */

import {
  journeyFromSignals,
  type JourneySignals,
} from '@/lib/reporting/journey-lookup';
import type { CandidateAnalysisSummary } from '@/types/reporting';
import type { CampaignAnalysisDatum } from '@/types/reporting';

export function analysisToDatum(
  a: CandidateAnalysisSummary,
  signals: JourneySignals,
): CampaignAnalysisDatum {
  const j = journeyFromSignals(signals, a.uid, a.status, a.hitlConfig);
  return {
    status: a.status,
    totalScore: a.totalScore,
    source: a.source,
    decisionZone: a.decisionZone,
    decidedBy: a.decidedBy,
    // HITL 3 zones : « intervention humaine » = un humain a tranché un gris
    // (decidedBy='user'), pas la dérivation journal/hitlConfig héritée.
    humanIntervention: a.decidedBy === 'user',
    recruited: j.final === 'retenu',
    // Contacté = a reçu une communication (invitation ou refus traité).
    contacted:
      j.final !== 'na' ||
      j.validation === 'retenu_entretien' ||
      j.interview !== 'na',
  };
}
