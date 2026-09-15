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
import { emitEvent } from './events';
import {
  getBookingLinkChain,
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
import { assertOk, chunk, fetchAllKeyset, table } from './store';
import { generateToken, isTokenShaped } from './tokens';
import { getTargetById } from './targets';
import type {
  AvailabilityCheck,
  Booking,
  BookingPageState,
  CancelVerdict,
  ConfirmBookingInput,
  ConfirmBookingResult,
  RescheduleResult,
  Resource,
  Slot,
  SlotOffer,
  Target,
} from './types';

const BOOKING_COLUMNS = '*';

/**
 * Réservation avec les clés externes de sa cible et de sa ressource JOINTES
 * (clés étrangères `target_id`, `resource_id`). Hydrater une réservation
 * coûtait deux lectures de plus par ligne.
 */
const BOOKING_COLUMNS_WITH_REFS =
  '*, target:sched_targets(external_ref), resource:sched_resources(external_ref)';

type BookingRowWithRefs = BookingRow & {
  target: { external_ref: string } | null;
  resource: { external_ref: string } | null;
};

/** Même repli que l'ancienne résolution séparée : l'identifiant interne. */
function toBookingWithRefs(row: BookingRowWithRefs): Booking {
  return toBooking(row, {
    targetExternalRef: row.target?.external_ref ?? row.target_id,
    resourceExternalRef: row.resource?.external_ref ?? row.resource_id,
  });
}

// ─── Page publique ──────────────────────────────────────────────────────

/**
 * Ce que le porteur d'un jeton a le droit de voir. Trois états seulement, et
 * aucun n'est une erreur technique : un lien mort ou une cible sans titulaire
 * doit produire une page compréhensible, pas une pile d'exception.
 */
export async function resolveBookingPage(token: string): Promise<BookingPageState> {
  // Lien, cible et ressource en une lecture.
  const chain = await getBookingLinkChain(token);
  if (!chain) return { status: 'gone', display: null, reason: 'unknown' };
  const { link, target } = chain;
  if (link.status !== 'active') {
    return { status: 'gone', display: link.display, reason: link.status };
  }

  const resource = target?.resourceId ? chain.resource : null;
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
  return (await listSlotOfferForLink(token, window)).slots;
}

/**
 * Même offre, en disant si elle est SUSPENDUE (source externe non vérifiée
 * au-delà de la tolérance). Seul un lien actif sur une ressource active peut
 * être suspendu : la page publique a déjà dit, à ce stade, que le lien existe.
 */
export async function listSlotOfferForLink(
  token: string,
  window: { from: string; to: string },
): Promise<SlotOffer> {
  const chain = await getBookingLinkChain(token);
  if (!chain || chain.link.status !== 'active') return { slots: [], unavailable: false };
  const resource = chain.target?.resourceId ? chain.resource : null;
  if (!resource || !resource.isActive) return { slots: [], unavailable: false };
  const { input, availability } = await loadEngineInput(resource, window);
  // Source externe illisible : aucune offre plutôt qu'une offre peut-être fausse.
  return availability.blocked
    ? { slots: [], unavailable: true }
    : { slots: computeSlots(input), unavailable: false };
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
  return (await listSlotOfferForManageToken(manageToken, window)).slots;
}

export async function listSlotOfferForManageToken(
  manageToken: string,
  window: { from: string; to: string },
): Promise<SlotOffer> {
  const found = await bookingWithResourceByManageToken(manageToken);
  if (!found || found.booking.status !== 'confirmed') return { slots: [], unavailable: false };
  const { booking, resource } = found;
  if (!resource || !resource.isActive) return { slots: [], unavailable: false };

  const { input: engineInput, availability } = await loadEngineInput(resource, window);
  if (availability.blocked) return { slots: [], unavailable: true };
  const slots = computeSlots({
    ...engineInput,
    busy: engineInput.busy.filter((busy) => busy.startAt !== booking.startAt),
  });
  return { slots, unavailable: false };
}

// ─── Confirmation ───────────────────────────────────────────────────────

export async function confirmBooking(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  // ── 1. Lien (+ cible et ressource, lues dans la même requête) ─────────
  const chain = await getBookingLinkChain(input.token);
  if (!chain) return { ok: false, reason: 'link_not_found' };
  const link = chain.link;
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
  const target = chain.target;
  if (!target?.resourceId) return { ok: false, reason: 'resource_unavailable' };
  const versionBefore = target.version;

  const resource = chain.resource;
  if (!resource || !resource.isActive) {
    return { ok: false, reason: 'resource_unavailable' };
  }

  // ── 1ter. Revalidation du créneau — source externe RELUE ─────────────
  // `live` : l'offre affichée a pu être calculée sur une lecture d'il y a une
  // minute. Au moment du clic, on relit. Un créneau devenu occupé entre-temps
  // tombe ici, exactement comme un créneau pris par un autre invité.
  const { input: engineInput, availability } = await loadEngineInput(
    resource,
    { from: input.startAt, to: input.startAt },
    'live',
  );
  if (availability.blocked) return { ok: false, reason: 'availability_unverified' };
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

  const booking = {
    ...toBooking(data as BookingRow, {
      targetExternalRef: target.externalRef,
      resourceExternalRef: resource.externalRef,
    }),
    availabilityCheck: await recordAvailabilityCheck(
      (data as BookingRow).id,
      availability.check,
    ),
  };

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
  /** Identifiant, ou la réservation déjà lue par l'appelant (aucune relecture). */
  bookingOrId: string | Booking,
  options?: { reason?: string | null; notifyAttendee?: boolean },
): Promise<CancelVerdict> {
  const booking =
    typeof bookingOrId === 'string' ? await getBooking(bookingOrId) : bookingOrId;
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
  // L'organisateur ne dépend pas de l'écriture de l'événement : lus ensemble,
  // et la notification part toujours APRÈS l'outbox.
  const [, organizer] = await Promise.all([
    emitEvent('booking.cancelled', cancelled, { cancelReason: reason }),
    resourceById(cancelled.resourceId),
  ]);
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
  const found = await bookingWithResourceByManageToken(manageToken);
  if (!found) return { ok: false, reason: 'booking_not_found' };
  const previous = found.booking;
  if (previous.status === 'cancelled') return { ok: false, reason: 'booking_cancelled' };

  const resource = found.resource;
  if (!resource || !resource.isActive) {
    return { ok: false, reason: 'resource_unavailable' };
  }

  // Même relecture qu'à la confirmation : un déplacement est une confirmation.
  const { input: engineInput, availability } = await loadEngineInput(
    resource,
    { from: input.startAt, to: input.startAt },
    'live',
  );
  if (availability.blocked) return { ok: false, reason: 'availability_unverified' };
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

  const next = {
    ...toBooking(renamed ?? claimed, {
      targetExternalRef: previous.targetExternalRef,
      resourceExternalRef: previous.resourceExternalRef,
    }),
    availabilityCheck: await recordAvailabilityCheck(claimed.id, availability.check),
  };

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
    .select(BOOKING_COLUMNS_WITH_REFS)
    .eq('link_token', linkToken)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<BookingRowWithRefs>();
  assertOk('getConfirmedBookingByLink', error);
  return data ? toBookingWithRefs(data) : null;
}

/**
 * Réservations CONFIRMÉES produites par un ensemble de liens, en une lecture
 * par tranche (au lieu d'une par lien). Exhaustif : pagination par clé.
 * L'appelant choisit parmi elles ; aucun ordre n'est garanti ici.
 */
export async function listConfirmedBookingsByLinkTokens(
  linkTokens: readonly string[],
): Promise<Booking[]> {
  const tokens = [...new Set(linkTokens.filter(isTokenShaped))];
  const slices = await Promise.all(
    chunk(tokens, 200).map((slice) =>
      fetchAllKeyset<BookingRowWithRefs>(
        'listConfirmedBookingsByLinkTokens',
        (after, limit) => {
          let query = table(TABLES.bookings)
            .select(BOOKING_COLUMNS_WITH_REFS)
            .in('link_token', slice)
            .eq('status', 'confirmed');
          if (after !== null) query = query.gt('id', after);
          return query.order('id', { ascending: true }).limit(limit);
        },
        (row) => row.id,
      ),
    ),
  );
  return slices.flat().map(toBookingWithRefs);
}

export async function getBooking(id: string): Promise<Booking | null> {
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS_WITH_REFS)
    .eq('id', id)
    .maybeSingle<BookingRowWithRefs>();
  assertOk('getBooking', error);
  return data ? toBookingWithRefs(data) : null;
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
    .select(BOOKING_COLUMNS_WITH_REFS)
    .eq('manage_token', manageToken)
    .order('created_at', { ascending: false })
    .limit(10);
  assertOk('getBookingByManageToken', error);

  const rows = (data ?? []) as BookingRowWithRefs[];
  const row = rows.find((r) => r.status === 'confirmed') ?? rows[0];
  return row ? toBookingWithRefs(row) : null;
}

export async function listBookings(filter?: {
  targetExternalRef?: string;
  /** La cible déjà lue par l'appelant : dispense de la relire par sa clé. */
  target?: Pick<Target, 'id'>;
  resourceExternalRef?: string;
  from?: string;
  to?: string;
  status?: 'confirmed' | 'cancelled';
}): Promise<Booking[]> {
  const [targetId, resourceId] = await Promise.all([
    filter?.target
      ? filter.target.id
      : filter?.targetExternalRef
        ? idByRef(TABLES.targets, filter.targetExternalRef)
        : null,
    filter?.resourceExternalRef
      ? idByRef(TABLES.resources, filter.resourceExternalRef)
      : null,
  ]);
  if ((filter?.target || filter?.targetExternalRef) && !targetId) return [];
  if (filter?.resourceExternalRef && !resourceId) return [];

  const rows = await fetchAllKeyset<BookingRowWithRefs>(
    'listBookings',
    (after, limit) => {
      let query = table(TABLES.bookings).select(BOOKING_COLUMNS_WITH_REFS);
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
  const bookings = rows.map(toBookingWithRefs);
  return bookings.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

// ─── Internes ───────────────────────────────────────────────────────────

/**
 * Trace de la vérification faite à la réservation. Écriture SÉPARÉE et
 * best-effort, jamais dans l'insertion qui tranche la concurrence : le code
 * doit rester déployable avant la migration qui crée la colonne, et une trace
 * manquée ne doit pas défaire un rendez-vous valablement pris.
 *
 * Rend la valeur réellement portée par la ligne (`null` si non écrite).
 */
async function recordAvailabilityCheck(
  bookingId: string,
  check: AvailabilityCheck,
): Promise<AvailabilityCheck | null> {
  try {
    const { error } = await table(TABLES.bookings)
      .update({ availability_check: check })
      .eq('id', bookingId);
    return error ? null : check;
  } catch {
    return null;
  }
}

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

/**
 * Réservation d'un jeton de gestion AVEC sa ressource complète, en une lecture
 * (même sélection que `getBookingByManageToken` : la confirmée d'abord, sinon
 * la plus récente). Sert aux créneaux de déplacement et au déplacement, qui
 * relisaient la ressource juste après.
 */
async function bookingWithResourceByManageToken(
  manageToken: string,
): Promise<{ booking: Booking; resource: Resource | null } | null> {
  if (!isTokenShaped(manageToken)) return null;
  const { data, error } = await table(TABLES.bookings)
    .select('*, target:sched_targets(external_ref), resource:sched_resources(*)')
    .eq('manage_token', manageToken)
    .order('created_at', { ascending: false })
    .limit(10);
  assertOk('getBookingByManageToken', error);

  const rows = (data ?? []) as (BookingRow & {
    target: { external_ref: string } | null;
    resource: ResourceRow | null;
  })[];
  const row = rows.find((r) => r.status === 'confirmed') ?? rows[0];
  if (!row) return null;
  return {
    booking: toBooking(row, {
      targetExternalRef: row.target?.external_ref ?? row.target_id,
      resourceExternalRef: row.resource?.external_ref ?? row.resource_id,
    }),
    resource: row.resource ? toResource(row.resource) : null,
  };
}

async function findBookingByLink(
  token: string,
  startAt: string,
): Promise<Booking | null> {
  const { data, error } = await table(TABLES.bookings)
    .select(BOOKING_COLUMNS_WITH_REFS)
    .eq('link_token', token)
    .eq('status', 'confirmed')
    .limit(5);
  assertOk('findBookingByLink', error);
  const target = Date.parse(startAt);
  const row = ((data ?? []) as BookingRowWithRefs[]).find(
    (candidate) => Date.parse(candidate.start_at) === target,
  );
  return row ? toBookingWithRefs(row) : null;
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
