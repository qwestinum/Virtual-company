/**
 * Réseaux de publication d'annonce supportés (Phase 3).
 *
 * Chaque channel correspond à un ton/format d'annonce différent
 * (cf. buildJobAdSystemPrompt). Le mode `generic` produit une
 * annonce neutre multi-réseaux — c'est le fallback recommandé
 * quand le DRH veut une annonce diffusable partout.
 *
 * Conforme R2 (audio-mode.md) : libellés énonçables et distincts à
 * l'écoute. « Welcome to the Jungle » est long mais reste prononçable
 * naturellement.
 */

import { z } from 'zod';

export const PUBLICATION_CHANNELS = [
  'linkedin',
  'indeed',
  'welcome_to_the_jungle',
  'apec',
  'france_travail',
  'generic',
] as const;

export const PublicationChannelSchema = z.enum(PUBLICATION_CHANNELS);
export type PublicationChannel = z.infer<typeof PublicationChannelSchema>;

export const PUBLICATION_CHANNEL_LABELS: Record<PublicationChannel, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  welcome_to_the_jungle: 'Welcome to the Jungle',
  apec: 'APEC',
  france_travail: 'France Travail',
  generic: 'Annonce générique',
};

/**
 * Ordre canonique d'affichage dans les chips (générique en dernier
 * comme fallback explicite). Réutilisé par le picker + le mapping
 * inverse label → channel utilisé à l'interception du chip click.
 */
export const PUBLICATION_CHANNEL_ORDER: PublicationChannel[] = [
  'linkedin',
  'indeed',
  'welcome_to_the_jungle',
  'apec',
  'france_travail',
  'generic',
];

/**
 * Mapping inverse libellé → channel. Sert au handler de chip click
 * pour identifier le réseau choisi.
 */
export function channelFromLabel(label: string): PublicationChannel | null {
  for (const ch of PUBLICATION_CHANNELS) {
    if (PUBLICATION_CHANNEL_LABELS[ch] === label) return ch;
  }
  return null;
}
