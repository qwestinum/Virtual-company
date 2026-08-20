/**
 * Série d'un rendez-vous — l'identité que voit l'agenda de l'invité.
 *
 * Un déplacement crée une NOUVELLE ligne : son identifiant ne peut donc pas
 * servir d'UID iCalendar, sinon l'agenda afficherait un second événement au
 * lieu de déplacer le premier. L'identité stable est la RACINE de la chaîne
 * `rescheduled_from`, et le rang dans cette chaîne donne le `SEQUENCE` — les
 * clients d'agenda s'en servent pour savoir quelle version l'emporte.
 *
 * Rien à stocker : la chaîne est déjà en base, on la remonte.
 */
import { TABLES } from './rows';
import { assertOk, table } from './store';
import type { Booking } from './types';

/** Garde-fou : une chaîne de déplacements plus longue est forcément un cycle. */
const MAX_HOPS = 50;

export type BookingSeries = {
  /** Identifiant du PREMIER rendez-vous de la chaîne — stable à vie. */
  rootId: string;
  /** Nombre de déplacements subis : 0 à la réservation, 1 au premier, etc. */
  sequence: number;
};

export async function resolveSeries(booking: Booking): Promise<BookingSeries> {
  let rootId = booking.id;
  let parent = booking.rescheduledFrom;
  let sequence = 0;

  while (parent && sequence < MAX_HOPS) {
    sequence += 1;
    rootId = parent;
    const { data, error } = await table(TABLES.bookings)
      .select('id, rescheduled_from')
      .eq('id', parent)
      .maybeSingle<{ id: string; rescheduled_from: string | null }>();
    assertOk('resolveSeries', error);
    if (!data) break; // ligne purgée : la racine connue fait foi
    parent = data.rescheduled_from;
  }

  return { rootId, sequence };
}
