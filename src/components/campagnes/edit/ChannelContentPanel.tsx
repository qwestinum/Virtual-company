'use client';

/**
 * Le panneau de CONTENU d'un canal de diffusion, s'il en a un.
 *
 * DEUX canaux seulement en portent, et pour la même raison : ils publient un
 * texte réellement lisible quelque part — « Annonce générique » alimente le
 * jobboard de démonstration, « APEC » envoie l'offre sur apec.fr. Les autres
 * canaux ne sont qu'une intention de diffusion, il n'y a rien à rédiger. La
 * liste, elle, vit dans `@/lib/campaign/post-activation-surfaces` (partagée
 * avec l'écran de création).
 *
 * Chaque panneau se retire de lui-même quand sa surface n'existe pas (la route
 * rend 404) : aucun flag à consulter ici.
 */

import type { PublicationChannel } from '@/types/publication-channel';

import { ApecPanel } from './ApecPanel';
import { GenericJobAdPanel } from './GenericJobAdPanel';

export function ChannelContentPanel({
  channel,
  campaignId,
}: {
  channel: PublicationChannel;
  campaignId: string;
}) {
  switch (channel) {
    case 'generic':
      return <GenericJobAdPanel campaignId={campaignId} />;
    case 'apec':
      return <ApecPanel campaignId={campaignId} />;
    default:
      return null;
  }
}
