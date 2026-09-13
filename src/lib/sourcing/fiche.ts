/**
 * Ce que le sourcing lit d'une campagne — PUR.
 *
 * Intitulé, séniorité, lieu de la fiche de poste ; critères de la fiche de
 * scoring. Rien d'autre n'entre dans la requête, et c'est voulu : salaire,
 * contrat, missions restent hors du moteur (règles mesurées, spec §3.2).
 */
import { fdpJobTitle, fdpText } from '@/types/job-post';
import type { FDPInProgress } from '@/types/field-collection';
import type { ScoringSheet } from '@/types/scoring';
import type { QueryFicheInput } from '@/types/sourcing';

export function campaignToQueryFiche(campaign: {
  fdp: FDPInProgress;
  scoringSheet: ScoringSheet | null;
}): QueryFicheInput {
  const seniority = campaign.fdp.fields.seniority?.value;
  return {
    jobTitle: fdpJobTitle(campaign.fdp),
    seniority: typeof seniority === 'string' && seniority.trim() ? seniority.trim() : null,
    location: fdpText(campaign.fdp, 'location'),
    criteria: (campaign.scoringSheet?.criteria ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      level: c.level,
      ...(c.keywords && c.keywords.length > 0 ? { keywords: c.keywords } : {}),
    })),
  };
}
