/**
 * L'ACTIVATION, sortie de l'écran — c'est le seul moment de l'assistant qui
 * agit sur le monde, et il mérite d'être lisible d'un bloc.
 *
 * Trois effets, dans cet ordre, et l'ordre porte une garantie :
 *   ① rattacher les boîtes mail — sinon le flux email serait MUET sur une
 *     campagne qui, elle, sera active ;
 *   ② poser le régime de réservation par PATCH ciblé — le flag et le lieu ne
 *     voyagent JAMAIS dans un snapshot (invariant du module de réservation) ;
 *   ③ passer le statut, et le persister.
 *
 * ⚠️ Rien de tout cela n'annule la campagne en cas d'échec : elle est déjà
 * enregistrée. Mais tout échec se DIT — croire sa campagne en réservation
 * native alors qu'elle envoie du Cal.com est pire qu'un avertissement, et une
 * boîte non rattachée fait une campagne qui ne recevra jamais rien.
 */

import { applyDraftScheduling } from '@/lib/campaign/apply-draft-scheduling';
import { associateMailbox } from '@/lib/campaign/mailbox-association';
import { persistCampaign } from '@/lib/db/sync/campaigns-sync';
import type { MeetingLocation } from '@/lib/scheduling';
import { useCampaignsStore } from '@/stores/campaigns-store';

export type ActivationOutcome = {
  activated: boolean;
  /** Ce qu'il faut DIRE au recruteur, ou `null` si tout s'est passé. */
  notice: string | null;
};

export async function activateFromAssistant(input: {
  campaignId: string;
  mailboxIds: string[];
  schedulingNative: boolean;
  meetingLocation: MeetingLocation | null;
}): Promise<ActivationOutcome> {
  const { campaignId } = input;
  const store = useCampaignsStore.getState();

  const echecs = (
    await Promise.all(input.mailboxIds.map((m) => associateMailbox(m, campaignId)))
  ).filter((r) => !r.ok).length;

  const scheduling = await applyDraftScheduling(
    campaignId,
    { native: input.schedulingNative, location: input.meetingLocation },
    false,
  );
  if (scheduling.kind === 'applied') {
    // Reflet LOCAL de ce que le SERVEUR a écrit — jamais une décision client.
    store.setSchedulingNative(campaignId, scheduling.native);
  }

  const activated = store.activateCampaign(campaignId);
  const campaign = useCampaignsStore.getState().byId[campaignId];
  if (activated && campaign) await persistCampaign(campaign);

  const notice =
    [
      activated
        ? null
        : 'La campagne reste en brouillon : il manque une étape obligatoire.',
      echecs > 0
        ? `${echecs} boîte mail n’a pas pu être rattachée — le flux email serait muet.`
        : null,
      scheduling.kind === 'failed' ? scheduling.message : null,
    ]
      .filter(Boolean)
      .join(' ') || null;

  return { activated, notice };
}
