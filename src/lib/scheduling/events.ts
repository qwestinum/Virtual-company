/**
 * Outbox d'événements — le canal par lequel l'hôte apprend ce qui se passe.
 *
 * L'événement est écrit DANS la séquence qui produit l'effet, puis dispatché
 * après. Si le dispatch échoue (ou si le processus meurt entre les deux), la
 * ligne reste en attente et le drain la reprend. Le prix de cette garantie est
 * une livraison AT-LEAST-ONCE : le consommateur doit être idempotent sur
 * `event.id`. C'est exactement le contrat qu'avait le webhook externe, mais
 * ici la file nous appartient.
 *
 * Le drain fait aussi de la RÉPARATION : une réservation confirmée sans
 * `booking.created` (crash entre le claim et l'écriture de l'outbox) est
 * rattrapée. Sans ça, un rendez-vous pourrait exister sans que personne ne
 * l'apprenne jamais — le pire état possible pour ce module.
 */
import { purgeExpiredRateLimits } from './rate-limit';
import { assertOk, chunk, fetchAllKeyset, table } from './store';
import { now, nowIso } from './runtime';
import { isoUtc, TABLES, toBooking, type BookingRow, type EventRow } from './rows';
import type {
  Booking,
  DrainResult,
  SchedEvent,
  SchedEventBooking,
  SchedEventConsumer,
  SchedEventType,
} from './types';

let consumer: SchedEventConsumer | null = null;

/** Un seul consommateur : l'hôte. Ré-enregistrer remplace le précédent. */
export function registerEventConsumer(handler: SchedEventConsumer | null): void {
  consumer = handler;
}

export function hasEventConsumer(): boolean {
  return consumer !== null;
}

export type EmitExtras = {
  cancelReason?: string | null;
  rescheduledFrom?: string;
  previousStartAt?: string;
};

/**
 * Écrit l'événement puis tente de le livrer. L'échec de livraison n'est PAS
 * une erreur pour l'appelant : la réservation est faite, la ligne est en file,
 * le drain s'en chargera.
 */
export async function emitEvent(
  type: SchedEventType,
  booking: Booking,
  extras: EmitExtras = {},
): Promise<SchedEvent> {
  const payload = toEventBooking(booking, extras);

  const { data, error } = await table(TABLES.events)
    .insert({ type, booking_id: booking.id, payload })
    .select('id, type, booking_id, payload, created_at, dispatched_at, attempts, last_error')
    .single<EventRow>();
  assertOk('emitEvent', error);

  const row = data as EventRow;
  const event: SchedEvent = {
    id: row.id,
    occurredAt: isoUtc(row.created_at),
    type,
    booking: payload,
  };
  await dispatch(event).catch(() => {});
  return event;
}

/**
 * Rejoue la file. Idempotent : une ligne déjà dispatchée n'est jamais reprise,
 * une ligne en échec l'est autant de fois qu'il faut (avec sa dernière erreur
 * conservée pour le diagnostic).
 */
export async function drainPendingEvents(options?: {
  limit?: number;
  /** Fenêtre de réparation, en heures. */
  repairWindowHours?: number;
}): Promise<DrainResult> {
  const limit = options?.limit ?? 200;
  // Entretien courant rattaché au drain : une table de compteurs qui grossit
  // sans fin est une fuite lente, et un mécanisme dédié pour la purger serait
  // un rouage de plus à surveiller.
  await purgeExpiredRateLimits(now());
  const repaired = await repairMissingCreatedEvents(options?.repairWindowHours ?? 24);

  const { data, error } = await table(TABLES.events)
    .select('id, type, booking_id, payload, created_at, dispatched_at, attempts, last_error')
    .is('dispatched_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  assertOk('drainPendingEvents', error);

  let dispatched = 0;
  let failed = 0;
  for (const row of (data ?? []) as EventRow[]) {
    const event: SchedEvent = {
      id: row.id,
      occurredAt: isoUtc(row.created_at),
      type: row.type as SchedEventType,
      booking: row.payload as SchedEventBooking,
    };
    const ok = await dispatch(event);
    if (ok) dispatched += 1;
    else failed += 1;
  }
  return { dispatched, failed, repaired };
}

// ─── Internes ───────────────────────────────────────────────────────────

/** true = livré (ou rien à livrer). Marque la ligne, jamais ne lève. */
async function dispatch(event: SchedEvent): Promise<boolean> {
  if (!consumer) return false; // pas de consommateur : la ligne attend
  try {
    await consumer(event);
    const { error } = await table(TABLES.events)
      .update({ dispatched_at: nowIso(), last_error: null })
      .eq('id', event.id)
      .is('dispatched_at', null);
    assertOk('dispatch.confirm', error);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await table(TABLES.events)
      .update({ last_error: message.slice(0, 500) })
      .eq('id', event.id)
      .then(
        () => undefined,
        () => undefined,
      );
    await bumpAttempts(event.id);
    return false;
  }
}

async function bumpAttempts(eventId: string): Promise<void> {
  const { data } = await table(TABLES.events)
    .select('attempts')
    .eq('id', eventId)
    .maybeSingle<{ attempts: number }>();
  if (!data) return;
  await table(TABLES.events)
    .update({ attempts: data.attempts + 1 })
    .eq('id', eventId)
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Réservations confirmées récentes sans `booking.created` : on émet l'événement
 * manquant. C'est le filet du crash entre le claim et l'outbox.
 */
async function repairMissingCreatedEvents(windowHours: number): Promise<number> {
  const since = new Date(Date.parse(nowIso()) - windowHours * 3_600_000).toISOString();

  const bookings = await fetchAllKeyset<BookingRow>(
    'repair.bookings',
    (after, limit) => {
      let query = table(TABLES.bookings)
        .select('*')
        .eq('status', 'confirmed')
        .gte('created_at', since);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  if (bookings.length === 0) return 0;

  // Découpage des `in()` : le RETOUR d'une requête reste sous le plafond
  // PostgREST quel que soit le volume de la fenêtre.
  const known = new Set<string>();
  for (const slice of chunk(
    bookings.map((row) => row.id),
    200,
  )) {
    const { data, error } = await table(TABLES.events)
      .select('booking_id')
      .eq('type', 'booking.created')
      .in('booking_id', slice);
    assertOk('repair.events', error);
    for (const row of (data ?? []) as { booking_id: string }[]) {
      known.add(row.booking_id);
    }
  }

  let repaired = 0;
  for (const row of bookings) {
    if (known.has(row.id)) continue;
    const refs = await resolveRefs(row.target_id, row.resource_id);
    await emitEvent('booking.created', toBooking(row, refs));
    repaired += 1;
  }
  return repaired;
}

export async function resolveRefs(
  targetId: string,
  resourceId: string,
): Promise<{ targetExternalRef: string; resourceExternalRef: string }> {
  const [target, resource] = await Promise.all([
    table(TABLES.targets)
      .select('external_ref')
      .eq('id', targetId)
      .maybeSingle<{ external_ref: string }>(),
    table(TABLES.resources)
      .select('external_ref')
      .eq('id', resourceId)
      .maybeSingle<{ external_ref: string }>(),
  ]);
  assertOk('resolveRefs.target', target.error);
  assertOk('resolveRefs.resource', resource.error);
  return {
    targetExternalRef: target.data?.external_ref ?? targetId,
    resourceExternalRef: resource.data?.external_ref ?? resourceId,
  };
}

function toEventBooking(booking: Booking, extras: EmitExtras): SchedEventBooking {
  return {
    id: booking.id,
    targetExternalRef: booking.targetExternalRef,
    resourceExternalRef: booking.resourceExternalRef,
    startAt: booking.startAt,
    endAt: booking.endAt,
    attendee: booking.attendee,
    meetingLocation: booking.meetingLocation,
    // Restitué TEL QUEL : le module n'a jamais regardé dedans.
    context: booking.context,
    ...(booking.cancelledBy ? { cancelledBy: booking.cancelledBy } : {}),
    ...(extras.cancelReason !== undefined ? { cancelReason: extras.cancelReason } : {}),
    ...(extras.rescheduledFrom ? { rescheduledFrom: extras.rescheduledFrom } : {}),
    ...(extras.previousStartAt ? { previousStartAt: extras.previousStartAt } : {}),
  };
}
