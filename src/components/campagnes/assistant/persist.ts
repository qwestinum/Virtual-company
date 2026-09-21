/**
 * L'ENREGISTREMENT d'un passage d'étape — le seul chemin d'écriture de
 * l'assistant, et c'est exactement celui de la création historique :
 * `addCampaign` (un upsert qui FUSIONNE) puis `persistCampaign`, qui attend la
 * confirmation du serveur avant de déclarer quoi que ce soit.
 *
 * ⚠️ `status: 'draft'` n'est posé QU'À LA CRÉATION. `addCampaign` laisse un
 * statut explicite écraser l'existant : le poser à chaque passage ferait
 * REDESCENDRE en brouillon une campagne déjà lancée — elle cesserait de
 * recevoir les candidatures par mail, sans que rien ne le dise.
 */

import { deriveCampaignName } from '@/lib/campaign/derive-campaign-name';
import type { RecruiterOption } from '@/lib/campaign/use-recruiter-options';
import { resolveDraftOwner } from '@/lib/campaign/use-recruiter-options';
import { cancelScheduledCampaignPush, persistCampaign } from '@/lib/db/sync/campaigns-sync';
import type { CampaignsState } from '@/stores/campaigns-store';
import { computeIsComplete, type FDPInProgress } from '@/types/field-collection';
import type { ScoringSheet } from '@/types/scoring';

import type { AssistantDraft } from './useAssistantDraft';

export type PersistOutcome =
  | { ok: true; name: string }
  | { ok: false; message: string };

export async function enregistrerBrouillon(input: {
  campaignId: string;
  draft: AssistantDraft;
  recruiterOptions: RecruiterOption[] | null;
  currentUserId: string | null;
  addCampaign: CampaignsState['addCampaign'];
  /** La campagne existe-t-elle déjà ? Si oui, on ne touche PAS à son statut. */
  existe: boolean;
}): Promise<PersistOutcome> {
  const { campaignId, draft } = input;
  const complete = computeIsComplete(draft.fdp.fields);
  const fdp: FDPInProgress = {
    ...draft.fdp,
    campaignId,
    isComplete: complete,
    isValidated: complete,
  };
  const scoringSheet: ScoringSheet = {
    campaignId,
    criteria: draft.criteria,
    isValidated: draft.criteria.length > 0,
  };

  const campaign = input.addCampaign({
    fdp,
    name: deriveCampaignName(fdp, draft.facts.jobTitle),
    scoringSheet,
    publishedChannels: draft.channels,
    sourcesConfirmed: draft.sources.length > 0,
    sources: draft.sources,
    thresholdLow: draft.thresholdLow,
    thresholdHigh: draft.thresholdHigh,
    ownerUserId: resolveDraftOwner(
      draft.ownerChoice,
      input.recruiterOptions,
      input.currentUserId,
    ),
    prefillExtraction: draft.prefillExtraction,
    status: input.existe ? undefined : 'draft',
  });

  // On reprend la main sur la persistance : le push de fond debouncé rejouerait
  // le PUT après un éventuel échec, et on ne déclare rien sans confirmation.
  cancelScheduledCampaignPush(campaign.id);
  const outcome = await persistCampaign(campaign);
  if (!outcome.ok) {
    return {
      ok: false,
      message: `Rien n’a été perdu : vos saisies sont là. L’enregistrement a échoué (${outcome.error}) — réessayez.`,
    };
  }
  return { ok: true, name: campaign.name };
}
