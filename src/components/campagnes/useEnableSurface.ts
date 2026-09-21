'use client';

/**
 * Activer une surface DEPUIS l'écran qui en a besoin.
 *
 * « Diffuser l'annonce » et « Chercher dans le vivier » se heurtaient à un
 * réglage pris ailleurs, à un autre moment : si le canal ou le flux n'avait pas
 * été coché à la création, l'écran ne proposait rien — il renvoyait vers un
 * formulaire, en laissant le recruteur refaire le chemin. Or vouloir diffuser
 * EST le moment où l'on choisit son canal.
 *
 * ⚠️ C'est une VRAIE écriture sur une campagne qui tourne, et elle est donc
 * confirmée par le serveur avant d'être déclarée : on ne montre pas un panneau
 * de rédaction adossé à un réglage qui n'a pas été enregistré.
 */

import { persistCampaign } from '@/lib/db/sync/campaigns-sync';
import { useCampaignsStore } from '@/stores/campaigns-store';
import type { CVSource } from '@/types/cv-source';
import type { PublicationChannel } from '@/types/publication-channel';

export type EnableOutcome = { ok: true } | { ok: false; message: string };

const ECHEC =
  'Le réglage n’a pas pu être enregistré. Réessayez, ou passez par les réglages de la campagne.';

async function confirmer(campaignId: string): Promise<EnableOutcome> {
  const campaign = useCampaignsStore.getState().byId[campaignId];
  if (!campaign) return { ok: false, message: ECHEC };
  const outcome = await persistCampaign(campaign);
  return outcome.ok ? { ok: true } : { ok: false, message: ECHEC };
}

/** Retient un canal de diffusion sur la campagne. */
export async function activerCanal(
  campaignId: string,
  channel: PublicationChannel,
): Promise<EnableOutcome> {
  useCampaignsStore.getState().markPublishedChannel(campaignId, channel);
  return confirmer(campaignId);
}

/** Retient un flux de réception (le vivier) sur la campagne. */
export async function activerFlux(
  campaignId: string,
  source: CVSource,
): Promise<EnableOutcome> {
  const campaign = useCampaignsStore.getState().byId[campaignId];
  if (!campaign) return { ok: false, message: ECHEC };
  if (!campaign.sources.includes(source)) {
    useCampaignsStore
      .getState()
      .setSources(campaignId, [...campaign.sources, source]);
  }
  return confirmer(campaignId);
}
