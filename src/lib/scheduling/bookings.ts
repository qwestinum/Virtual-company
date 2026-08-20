/**
 * Réservations — la séquence de confirmation et son cycle de vie.
 *
 * La séquence (spec §3) est écrite ici À LA LETTRE, et l'ordre des étapes est
 * la garantie, pas un détail d'implémentation :
 *
 *   1. relire la cible (version) + le lien + REVALIDER le créneau ;
 *   2. INSÉRER la réservation — c'est le CLAIM : l'index unique partiel
 *      (resource_id, start_at) where confirmed tranche la concurrence en une
 *      instruction. Deux invités sur le même créneau ⇒ un seul gagnant, et le
 *      perdant l'apprend par un 23505, pas par un état incohérent ;
 *   3. consommer le lien (update conditionné à `active`). 0 ligne ⇒ le lien a
 *      été révoqué entre-temps ⇒ COMPENSATION ;
 *   4. relire la version de la cible. Elle a bougé ⇒ un re-pointage a eu lieu
 *      pendant la confirmation ⇒ COMPENSATION, l'invité recharge et voit
 *      l'agenda du nouveau titulaire ;
 *   5. écrire l'événement (outbox), puis notifier.
 *
 * COMPENSER = supprimer la réservation. Rien ne l'a observée (aucun événement
 * n'est parti), et la supprimer libère immédiatement le créneau. On ne laisse
 * jamais traîner une réservation « à moitié faite ».
 */
import { isSlotClaimConflict } from './errors';
import { emitEvent, resolveRefs } from './events';
import {
  getBookingLink,
  markLinkUsed,
  restoreLinkActive,
} from './links';
import { resolveMeetingLocation } from './meeting-location';
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  notifyBookingRescheduled,
} from './notifications';
import { loadEngineInput } from './resources';
import { nowIso } from './runtime';
import { TABLES, toBooking, toResource, type BookingRow, type ResourceRow } from './rows';
import { computeSlots, findOfferedSlot } from './slots';
import { assertOk, fetchAllKeyset, table } from './store';
import { generateToken, isTokenShaped } from './tokens';
import { getTargetById } from './targets';
import type {
  Booking,
  BookingPageState,
  CancelVerdict,
  ConfirmBookingInput,
  ConfirmBookingResult,
  RescheduleResult,
  Resource,
  Slot,
} from './types';

const BOOKING_COLUMNS = '*';

// ─── Page publique ──────────────────────────────────────────────────────

/**
 * Ce que le porteur d'un jeton a le droit de voir. Trois états seulement, et
 * aucun n'est une erreur technique : un lien mort ou une cible sans titulaire
 * doit produire une page compréhensible, pas une pile d'exception.
 */
export async function resolveBookingPage(token: string): Promise<BookingPageState> {
  const link = await getBookingLink(token);
  if (!link) return { status: 'gone', display: null, reason: 'unknown' };
  if (link.status !== 'active') {
    return { status: 'gone', display: link.display, reason: link.status };
  }

  const target = await getTargetById(link.targetId);
  const resource = target?.resourceId ? await resourceById(target.resourceId) : null;
  if (!resource || !resource.isActive) {
    return { status: 'degraded', display: link.display };
  }

  return {
    status: 'open',
    display: link.display,
    resource: {
      displayName: resource.displayName,
      timezone: resource.timezone,
      slotDurationMinutes: resource.slotDurationMinutes,
    },
    meetingLocationType:
      resolveMeetingLocation({
        resourceDefault: resource.meetingLocation,
        targetOverride: target?.meetingLocationOverride ?? null,
      })?.type ?? null,
    expiresAt: link.expiresAt,
  };
}

/** Créneaux offerts pour un jeton. Liste vide = réponse valide, pas une panne. */
export async function listSlotsForLink(
  token: string,
  window: { from: string; to: string },
): Promise<Slot[]> {
  const link = await getBookingLink(token);
  if (!link || link.status !== 'active') return [];
  const target = await getTargetById(link.targetId);
  const resource = target?.resourceId ? await resourceById(target.resourceId) : null;
  if (!resource || !resource.isActive) return [];
  return computeSlots(await loadEngineInput(resource, window));
}

/**
 * Créneaux offerts pour un DÉPLACEMENT. Le créneau actuellement réservé est
 * réintégré : sans lui, l'invité qui ouvre la page voit son propre horaire
 * absent de la liste et croit l'avoir perdu.
 */
export async function listSlotsForManageToken(
  manageToken: string,
  window: { from: string; to: string },
): Promise<Slot[]> {
  const booking = await getBookingByManageToken(manageToken);
  if (!booking || booking.status !== 'confirmed') return [];
  const resource = await resourceById(booking.resourceId);
  if (!resource || !resource.isActive) return [];

  const engineInput = await loadEngineInput(resource, window);
  const slots = computeSlots({
    ...engineInput,
    busy: engineInput.busy.filter((busy) => busy.startAt !== booking.startAt),
  });
  return slots;
}

// ─── Confirmation ───────────────────────────────────────────────────────

export async function confirmBooking(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  // ── 1. Lien ──────────────────────────────────────────────────────────
  const link = await getBookingLink(input.token);
  if (!link) return { ok: false, reason: 'link_not_found' };
  if (link.status === 'expired') return { ok: false, reason: 'link_expired' };
  if (link.status === 'revoked') return { ok: false, reason: 'link_gone' };
  if (link.status === 'used') {
    // Rejeu (double-clic, retour réseau) : si CE lien a déjà produit ce
    // rendez-vous, on le renvoie. Une erreur ici ferait douter l'invité d'une
    // réservation pourtant bien enregistrée.
    const existing = await findBookingByLink(link.token, input.startAt);
    return existing
      ? { ok: true, booking: existing, manageToken: existing.manageToken, replay: true }
      : { ok: false, reason: 'link_gone' };
  }

  // ── 1bis. Cible + ressource ──────────────────────────────────────────
  const target = await getTargetById(link.targetId);
  if (!target?.resourceId) return { ok: false, reason: 'resource_unavailable' };
  const versionBefore = target.version;

  const resource = await resourceById(target.resourceId);
  if (!resource || !resource.isActive) {
    return { ok: false, reason: 'resource_unavailable' };
  }

  // ── 1ter. Revalidation du créneau ────────────────────────────────────
  const engineInput = await loadEngineInput(resource, {
    from: input.startAt,
    to: input.startAt,
  });
  const slot = findOfferedSlot(engineInput, input.startAt);
  if (!slot) return { ok: false, reason: 'invalid_slot' };

  // ── 2. CLAIM : l'insertion tranche la concurrence ────────────────────
  const manageToken = generateToken();
  const { data, error } = await table(TABLES.bookings)
    .insert({
      link_token: link.token,
      target_id: target.id,
      resource_id: resource.id,
      start_at: slot.startAt,
      end_at: slot.endAt,
      attendee_name: input.attendee.name,
      attendee_email: input.attendee.email,
      attendee_phone: input.attendee.phone ?? null,
      attendee_timezone: input.attendee.timezone,
      context: link.context ?? {},
      meeting_location: resolveMeetingLocation({
        resourceDefault: resource.meetingLocation,
        targetOverride: target.meetingLocationOverride,
      }),
      manage_token: manageToken,
    })
    .select(BOOKING_COLUMNS)
    .single<BookingRow>();

  if (isSlotClaimConflict(error)) return { ok: false, reason: 'slot_taken' };
  assertOk('confirmBooking.claim', error);

  const booking = toBooking(data as BookingRow, {
    targetExternalRef: target.externalRef,
    resourceExternalRef: resource.externalRef,
  });

  // ── 3. Consommer le lien ─────────────────────────────────────────────
  if (!(await markLinkUsed(link.token))) {
    await compensate(booking.id);
    return { ok: false, reason: 'link_gone' };
  }

  // ── 4. La cible a-t-elle bougé pendant tout ça ? ─────────────────────
  const targetAfter = await getTargetById(link.targetId);
  if (!targetAfter || targetAfter.version !== versionBefore) {
    await compensate(booking.id);
    // Le lien redevient actif : l'invité recharge et réserve chez le nouveau
    // titulaire avec le MÊME lien — on ne lui demande pas d'en réclamer un autre.
    await restoreLinkActive(link.token);
    return { ok: false, reason: 'target_changed' };
  }

  // ── 5. Outbox puis notification ──────────────────────────────────────
  await emitEvent('booking.created', booking);
  await notifyBookingConfirmed(booking, resource.notifyEmail, resource.displayName);

  return { ok: true, booking, manageToken, replay: false };
}

// ─── Annulation ─────────────────────────────────────────────────────────

export async function cancelBookingByAttendee(
  manageToken: string,
  options?: { reason?: string | null },
): Promise<CancelVerdict> {
  const booking = await getBookingByManageToken(manageToken);
  if (!booking) return 'not_found';
  return cancelBooking(booking, 'attendee', options?.reason ?? null, true);
}

/**
 * `notifyAttendee: false` existe pour l'hôte qui communique lui-même (une
 * clôture de dossier porte déjà son message) — deux voix pour un même fait,
 * c'est une de trop.
 */
export async function cancelBookingByOrganizer(
  bookingId: string,
  options?: { reason?: string | null; notifyAttendee?: boolean },
): Promise<CancelVerdict> {
  const booking = await getBooking(bookingId);
  if (!booking) return 'not_found';
  return cancelBooking(
    booking,
    'organizer',
    options?.reason ?? null,
    options?.notifyAttendee ?? true,
  );
}

async function cancelBooking(
  booking: Booking,
  by: 'attendee' | 'organizer',
  reason: string | null,
  notifyAttendee: boolean,
): Promise<CancelVerdict> {
  if (booking.status === 'cancelled') return 'already_cancelled';

  const { data, error } = await table(TABLES.bookings)
    .update({
      status: 'cancelled',
      cancelled_by: by,
      cancelled_reason: reason,
      cancelled_at: nowIso(),
    })
    .eq('id', booking.id)
    .eq('status', 'confirmed')
    .select(BOOKING_COLUMNS)
    .maybeSingle<BookingRow>();
  assertOk('cancelBooking', error);
  if (!data) return 'already_cancelled'; // course perdue : quelqu'un a annulé avant

  const cancelled = toBooking(data, {
    targetExternalRef: booking.targetExternalRef,
    resourceExternalRef: booking.resourceExternalRef,
  });
  await emitEvent('booking.cancelled', cancelled, { cancelReason: reason });
  const organizer = await resourceById(cancelled.resourceId);
  await notifyBookingCancelled(
    cancelled,
    organizer?.notifyEmail ?? null,
    notifyAttendee,
    organizer?.displayName,
  );
  return 'cancelled';
}

// ─── Replanification ────────────────────────────────────────────────────

/**
 * Déplacer = re-claimer un créneau puis annuler l'ancien, dans cet ordre : si
 * le nouveau créneau est pris entre-temps, l'invité garde son rendez-vous
 * initial. On ne libère jamais un engagement avant d'en avoir sécurisé un autre.
 *
 * Le jeton de gestion est REPORTÉ sur la nouvelle ligne : tous les messages
 * déjà reçus par l'invité continuent de fonctionner. Ce report se fait en TROIS
 * temps, et l'ordre est imposé par l'unicité du jeton parmi les confirmées :
 *
 *   1. insérer la nouvelle réservation avec un jeton PROVISOIRE — la réutiliser
 *      tout de suite violerait l'unicité (deux lignes confirmées, même jeton) ;
 *   2. annuler l'ancienne, ce qui libère le jeton ;
 *   3. le poser sur la nouvelle.
 *
 * Le claim (la seule étape qu'une course peut faire perdre) reste en premier.
 * Si le report final échoue, la réservation existe et fait foi : on rend le
 * jeton réellement porté par la ligne, jamais celui qu'on espérait poser.
 */
export async function rescheduleBooking(
  manageToken: string,
  input: { startAt: string },
): Promise<RescheduleResult> {
  const previous = await getBookingByManageToken(manageToken);
  if (!previous) return { ok: false, reason: 'booking_not_found' };
  if (previous.status === 'cancelled') return { ok: false, reason: 'booking_cancelled' };

  const resource = await resourceById(previous.resourceId);
  if (!resource || !resource.isActive) {
    return { ok: false, reason: 'resource_unavailable' };
  }

  const engineInput = await loadEngineInput(resource, {
    from: input.startAt,
    to: input.startAt,
  });
  const slot = findOfferedSlot(engineInput, input.startAt);
  if (!slot) return { ok: false, reason: 'invalid_slot' };

  const { data, error } = await table(TABLES.bookings)
    .insert({
      link_token: previous.linkToken,
      target_id: previous.targetId,
      resource_id: previous.resourceId,
      start_at: slot.startAt,
      end_at: slot.endAt,
      rescheduled_from: previous.id,
      attendee_name: previous.attendee.name,
      attendee_email: previous.attendee.email,
      attendee_phone: previous.attendee.phone,
      attendee_timezone: previous.attendee.timezone,
      context: previous.context ?? {},
      meeting_location: previous.meetingLocation,
      // Jeton PROVISOIRE — le définitif est repris à l'étape 3, une fois
      // l'ancienne ligne annulée (cf. l'en-tête de cette fonction).
      manage_token: generateToken(),
    })
    .select(BOOKING_COLUMNS)
    .single<BookingRow>();

  if (isSlotClaimConflict(error)) return { ok: false, reason: 'slot_taken' };
  assertOk('rescheduleBooking.claim', error);

  const claimed = data as BookingRow;

  const { error: closeError } = await table(TABLES.bookings)
    .update({
      status: 'cancelled',
      cancelled_by: 'attendee',
      cancelled_reason: 'rescheduled',
      cancelled_at: nowIso(),
    })
    .eq('id', previous.id)
    .eq('status', 'confirmed');
  assertOk('rescheduleBooking.close', closeError);

  // Le jeton de l'ancienne ligne est libre : on le reprend. Best-effort — en
  // cas d'échec, la ligne garde son jeton provisoire, qui part alors dans la
  // notification. Mieux vaut un lien de gestion neuf qu'un lien annoncé qui
  // ne correspond à rien.
  const { data: renamed } = await table(TABLES.bookings)
    .update({ manage_token: previous.manageToken })
    .eq('id', claimed.id)
    .eq('status', 'confirmed')
    .select(BOOKING_COLUMNS)
    .maybeSingle<BookingRow>();

  const next = toBooking(renamed ?? claimed, {
    targetExternalRef: previous.targetExternalRef,
    resourceExternalRef: previous.resourceExternalRef,
  });

  // UN SEUL événement : un déplacement est un fait, pas une annulation suivie
  // d'une création (l'hôte ne doit pas voir passer un état « sans RDV »).
  await emitEvent('booking.rescheduled', next, {
    rescheduledFrom: previous.id,
    previousStartAt: previous.startAt,
  });
  await notifyBookingRescheduled(next, previous, resource.notifyEmail, resource.displayName);

  return { ok: true, booking: next, previous };
}

// ─── Lectures ───────────────────────────────────────────────────────────

/**
 * Réservation CONFIRMÉE produite par un lien donné. Sert à rappeler le
 * rendez-vous quand quelqu'un rouvre un lien déjà consommé — une lecture
 * ciblée, jamais un parcours de toutes les réservations.
 */
export async function getConfirmedBookingByLink(
  linkToken: string,
): Promise<Booking | null> {
  if (!isTokenShaped(linkToken)) return null;
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS)
    .eq('link_token', linkToken)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<BookingRow>();
  assertOk('getConfirmedBookingByLink', error);
  return data ? hydrate(data) : null;
}

export async function getBooking(id: string): Promise<Booking | null> {
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .maybeSingle<BookingRow>();
  assertOk('getBooking', error);
  return data ? hydrate(data) : null;
}

/**
 * Résolution d'un jeton de gestion : la ligne CONFIRMÉE d'abord (le jeton est
 * reporté lors d'un déplacement), sinon la plus récente — un rendez-vous
 * annulé doit rester consultable par son porteur.
 */
export async function getBookingByManageToken(
  manageToken: string,
): Promise<Booking | null> {
  if (!isTokenShaped(manageToken)) return null;
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS)
    .eq('manage_token', manageToken)
    .order('created_at', { ascending: false })
    .limit(10);
  assertOk('getBookingByManageToken', error);

  const rows = (data ?? []) as BookingRow[];
  const row = rows.find((r) => r.status === 'confirmed') ?? rows[0];
  return row ? hydrate(row) : null;
}

export async function listBookings(filter?: {
  targetExternalRef?: string;
  resourceExternalRef?: string;
  from?: string;
  to?: string;
  status?: 'confirmed' | 'cancelled';
}): Promise<Booking[]> {
  const targetId = filter?.targetExternalRef
    ? await idByRef(TABLES.targets, filter.targetExternalRef)
    : null;
  const resourceId = filter?.resourceExternalRef
    ? await idByRef(TABLES.resources, filter.resourceExternalRef)
    : null;
  if (filter?.targetExternalRef && !targetId) return [];
  if (filter?.resourceExternalRef && !resourceId) return [];

  const rows = await fetchAllKeyset<BookingRow>(
    'listBookings',
    (after, limit) => {
      let query = table(TABLES.bookings).select(BOOKING_COLUMNS);
      if (targetId) query = query.eq('target_id', targetId);
      if (resourceId) query = query.eq('resource_id', resourceId);
      if (filter?.status) query = query.eq('status', filter.status);
      if (filter?.from) query = query.gte('start_at', filter.from);
      if (filter?.to) query = query.lte('start_at', filter.to);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  const bookings = await Promise.all(rows.map(hydrate));
  return bookings.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

// ─── Internes ───────────────────────────────────────────────────────────

/**
 * CONTRAT DE COMPENSATION — la seule suppression de réservation du module.
 *
 * Supprimer est légal UNIQUEMENT tant que la réservation n'a jamais été
 * observée, et le critère objectif de « jamais observée » est : AUCUN
 * événement n'a été inséré dans l'outbox pour elle. Dès qu'une ligne
 * d'événement existe, le fait est sorti du module (livré, ou en file et
 * livrable à tout moment) : le seul retour en arrière admissible devient
 * l'annulation, qui laisse une trace et produit son propre événement.
 *
 * La garde ci-dessous applique ce contrat plutôt que de le documenter : une
 * évolution qui déplacerait l'écriture de l'outbox avant une compensation
 * échouerait bruyamment ici, au lieu d'effacer un rendez-vous déjà annoncé.
 */
async function compensate(bookingId: string): Promise<void> {
  const { data, error } = await table(TABLES.events)
    .select('id')
    .eq('booking_id', bookingId)
    .limit(1);
  assertOk('compensate.guard', error);
  if (((data ?? []) as { id: string }[]).length > 0) {
    throw new Error(
      `compensate: la réservation ${bookingId} a déjà produit un événement — ` +
        'suppression refusée (utiliser une annulation).',
    );
  }

  const { error: deleteError } = await table(TABLES.bookings)
    .delete()
    .eq('id', bookingId);
  assertOk('compensate', deleteError);
}

async function hydrate(row: BookingRow): Promise<Booking> {
  return toBooking(row, await resolveRefs(row.target_id, row.resource_id));
}

async function findBookingByLink(
  token: string,
  startAt: string,
): Promise<Booking | null> {
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS)
    .eq('link_token', token)
    .eq('status', 'confirmed')
    .limit(5);
  assertOk('findBookingByLink', error);
  const target = Date.parse(startAt);
  const row = ((data ?? []) as BookingRow[]).find(
    (candidate) => Date.parse(candidate.start_at) === target,
  );
  return row ? hydrate(row) : null;
}

async function resourceById(id: string): Promise<Resource | null> {
  const { data, error } = await table(TABLES.resources)
    .select('*')
    .eq('id', id)
    .maybeSingle<ResourceRow>();
  assertOk('resourceById', error);
  return data ? toResource(data) : null;
}

async function idByRef(tableName: string, externalRef: string): Promise<string | null> {
  const { data, error } = await table(tableName)
    .select('id')
    .eq('external_ref', externalRef)
    .maybeSingle<{ id: string }>();
  assertOk('idByRef', error);
  return data?.id ?? null;
}
