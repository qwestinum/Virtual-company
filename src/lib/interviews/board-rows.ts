/**
 * Rapprochement des réservations d'une même CANDIDATURE — pur.
 *
 * Une replanification ne déplace pas un rendez-vous : elle le décommande et
 * renvoie un lien, parce que c'est le candidat qui choisit son créneau. Il
 * reste donc, en base, une réservation annulée par replanification — puis une
 * deuxième, puis une troisième. Listées telles quelles, elles s'empilent et
 * donnent à lire une suite d'échecs là où il n'y a qu'un rendez-vous en cours
 * de calage.
 *
 * L'écran doit donc montrer UNE ligne par candidature, dans son état COURANT,
 * et non une ligne par réservation. La clé du rapprochement est
 * l'identifiant d'analyse porté par le contexte du lien — la même que celle
 * qui sert d'idempotence à l'émission.
 *
 * Trois états, et le second est celui qui manquait :
 *   - `confirmed`          : un créneau est pris ;
 *   - `awaiting_rebooking` : le créneau est tombé MAIS un lien actif attend —
 *     quelqu'un a déjà relancé, il n'y a rien à faire ;
 *   - `cancelled`          : le créneau est tombé et personne n'a relancé —
 *     c'est le seul cas qui appelle une action.
 */

export type BookingFacts = {
  bookingId: string;
  /** Candidature — clé du rapprochement. `null` : réservation hors ORQA. */
  analysisId: string | null;
  status: 'confirmed' | 'cancelled';
  cancelledBy: 'attendee' | 'organizer' | null;
  startAt: string;
};

export type CandidatureState = 'confirmed' | 'awaiting_rebooking' | 'cancelled';

export type GroupedBooking<T extends BookingFacts> = {
  /** La réservation à AFFICHER : celle qui porte l'état courant. */
  current: T;
  state: CandidatureState;
  /**
   * Nombre de créneaux tombés avant celui-ci. Affiché discrètement : « 2
   * replanifications » se lit en un coup d'œil, deux lignes d'annulation non.
   */
  droppedSlots: number;
};

/**
 * Une ligne par candidature, la plus parlante d'abord : les rendez-vous à
 * venir, puis ce qui attend une réservation, puis ce qui demande une action.
 *
 * `activeLinkKeys` = candidatures ayant un lien de réservation ENCORE actif.
 * Sans cette information, on ne peut pas distinguer « annulé, personne n'a
 * relancé » de « annulé, un nouveau lien est déjà parti » — et c'est
 * exactement la distinction que l'écran doit rendre.
 */
export function groupByCandidature<T extends BookingFacts>(
  bookings: T[],
  activeLinkKeys: ReadonlySet<string>,
): GroupedBooking<T>[] {
  const groups = new Map<string, T[]>();
  for (const booking of bookings) {
    // Sans candidature, la réservation est son propre groupe : on ne
    // rapproche jamais deux inconnues « parce qu'elles se ressemblent ».
    const key = booking.analysisId ?? `booking:${booking.bookingId}`;
    const list = groups.get(key);
    if (list) list.push(booking);
    else groups.set(key, [booking]);
  }

  const rows: GroupedBooking<T>[] = [];
  for (const [key, list] of groups) {
    const confirmed = [...list]
      .filter((b) => b.status === 'confirmed')
      .sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
    const cancelled = [...list]
      .filter((b) => b.status === 'cancelled')
      .sort((a, b) => b.startAt.localeCompare(a.startAt));

    const current = confirmed ?? cancelled[0];
    if (!current) continue;

    const state: CandidatureState = confirmed
      ? 'confirmed'
      : key.startsWith('booking:') || !activeLinkKeys.has(key)
        ? 'cancelled'
        : 'awaiting_rebooking';

    rows.push({ current, state, droppedSlots: cancelled.length });
  }

  const rank: Record<CandidatureState, number> = {
    confirmed: 0,
    awaiting_rebooking: 1,
    cancelled: 2,
  };
  return rows.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      // À venir : le plus proche d'abord. Retombé : le plus récent d'abord.
      (a.state === 'confirmed'
        ? a.current.startAt.localeCompare(b.current.startAt)
        : b.current.startAt.localeCompare(a.current.startAt)),
  );
}
