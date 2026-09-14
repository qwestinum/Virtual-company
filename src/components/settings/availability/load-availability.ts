/**
 * Chargement des disponibilités d'un recruteur — et son PRÉ-CHARGEMENT.
 *
 * La section « Agendas & disponibilités » attendait la liste des recruteurs
 * avant de monter l'éditeur, qui seulement alors lisait les disponibilités :
 * deux allers-retours en file. Quand l'utilisateur courant est connu, sa
 * lecture part désormais EN MÊME TEMPS que la liste, et l'éditeur la reprend
 * s'il s'ouvre bien sur cet agenda.
 *
 * Ce qui ne change pas : ce qu'affiche l'écran. Le pré-chargement n'est
 * consommé qu'UNE fois, par un éditeur ouvert sur le MÊME recruteur ; revenir
 * plus tard sur cet agenda relit le serveur, exactement comme avant. Ce n'est
 * pas un cache : il ne vit que le temps du montage de la section.
 */

import type { RuleDraft } from '@/lib/interviews/availability-form';
import type { MeetingLocation, Slot } from '@/lib/scheduling';

import type { SlotSettings } from './SlotSettingsRow';

export type AvailabilityPayload = {
  resource: (SlotSettings & { meetingLocation: MeetingLocation | null }) | null;
  rules: RuleDraft[];
  exceptions: { day: string; label: string | null }[];
  preview: Slot[];
  message?: string;
};

export function availabilityEndpoint(recruiterId: string): string {
  return `/api/recruiters/${encodeURIComponent(recruiterId)}/availability`;
}

/**
 * Lecture initiale. `null` = rien d'exploitable (réponse en erreur ou réseau
 * KO) : l'éditeur garde alors ses valeurs par défaut, comme avant.
 */
export async function fetchAvailability(
  recruiterId: string,
  fetcher: typeof fetch = fetch,
): Promise<AvailabilityPayload | null> {
  try {
    const res = await fetcher(availabilityEndpoint(recruiterId), { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as AvailabilityPayload;
  } catch {
    return null;
  }
}

export type PreloadedAvailability = {
  recruiterId: string;
  promise: Promise<AvailabilityPayload | null>;
  /** Posé quand un éditeur a APPLIQUÉ ce chargement : il ne resservira plus. */
  used: boolean;
};

/** Le pré-chargement utilisable pour cet agenda, sinon `null` (on relit). */
export function usablePreload(
  preload: PreloadedAvailability | null | undefined,
  recruiterId: string,
): Promise<AvailabilityPayload | null> | null {
  if (!preload || preload.used || preload.recruiterId !== recruiterId) return null;
  return preload.promise;
}
