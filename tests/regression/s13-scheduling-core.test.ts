/**
 * S13 — Module de réservation, cœur (lot 1).
 *
 * Ce que ce scénario prouve, contre la base DEV réelle : les invariants du
 * module ne tiennent pas seulement quand tout va bien, mais quand deux choses
 * arrivent en même temps.
 *
 *   1. deux invités sur le même créneau ⇒ un seul gagnant ;
 *   2. ré-émettre un lien avec la même clé ⇒ le même jeton ;
 *   3. lien consommé pendant une confirmation ⇒ compensation, rien ne reste ;
 *   4. cible re-pointée pendant une confirmation ⇒ compensation + lien rendu ;
 *   5. un événement déjà livré n'est jamais relivré par le drain ;
 *   6. une réservation sans événement est rattrapée par le drain.
 *
 * Marqueur de purge : toutes les clés externes sont préfixées `SCHED-TREG-`.
 * Le nettoyage est fait PAR MARQUEUR (requêtes, pas mémoire de run) : il est
 * idempotent et fonctionne même après un crash au milieu d'un test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cancelBookingByAttendee,
  configureScheduling,
  confirmBooking,
  createBookingLink,
  createResource,
  createTarget,
  drainPendingEvents,
  getBookingByManageToken,
  listSlotsForLink,
  registerEventConsumer,
  repointTarget,
  rescheduleBooking,
  resetSchedulingConfig,
  resolveBookingPage,
  revokeLinkByKey,
  setWeeklyRules,
  type SchedEvent,
} from '@/lib/scheduling';

import { db } from './helpers/db';

const REF_PREFIX = 'SCHED-TREG-';
const suffix = Math.random().toString(36).slice(2, 8);
const RESOURCE_REF = `${REF_PREFIX}res-${suffix}`;
const TARGET_REF = `${REF_PREFIX}tgt-${suffix}`;

/** Tous les événements reçus par l'hôte simulé, dans l'ordre. */
const received: SchedEvent[] = [];

const eventsFor = (bookingId: string): SchedEvent[] =>
  received.filter((event) => event.booking.id === bookingId);

let attendeeSeq = 0;
function attendee() {
  attendeeSeq += 1;
  return {
    name: `Invité ${attendeeSeq}`,
    email: `invite-${attendeeSeq}-${suffix}@test.local`,
    timezone: 'Europe/Paris',
  };
}

/** Jeton frais : une clé d'idempotence par test, sauf test d'idempotence. */
async function freshLink(key: string): Promise<string> {
  const link = await createBookingLink({
    targetExternalRef: TARGET_REF,
    idempotencyKey: `${key}-${suffix}`,
    context: { probe: key },
    display: { title: 'Rendez-vous de test' },
  });
  return link.token;
}

const WINDOW = () => ({
  from: new Date(Date.now() + 60_000).toISOString(),
  to: new Date(Date.now() + 21 * 86_400_000).toISOString(),
});

async function slotsOf(token: string) {
  return listSlotsForLink(token, WINDOW());
}

async function cleanScheduling(): Promise<void> {
  const supabase = db();

  const { data: targets } = await supabase
    .from('sched_targets')
    .select('id')
    .like('external_ref', `${REF_PREFIX}%`);
  const targetIds = (targets ?? []).map((row) => row.id as string);
  if (targetIds.length > 0) {
    // Les ÉVÉNEMENTS d'abord — la cascade le ferait, on l'écrit quand même :
    // c'est l'ordre qui compte si la contrainte changeait.
    const { data: bookings } = await supabase
      .from('sched_bookings')
      .select('id')
      .in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((row) => row.id as string);
    if (bookingIds.length > 0) {
      await supabase.from('sched_events').delete().in('booking_id', bookingIds);
    }
    // Les réservations partent AVANT les ressources (FK `on delete restrict`).
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }

  const { data: resources } = await supabase
    .from('sched_resources')
    .select('id')
    .like('external_ref', `${REF_PREFIX}%`);
  const resourceIds = (resources ?? []).map((row) => row.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase
      .from('sched_availability_exceptions')
      .delete()
      .in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
}

beforeAll(async () => {
  configureScheduling({
    supabase: db(),
    publicBaseUrl: 'https://treg.test.local',
  });
  registerEventConsumer(async (event) => {
    received.push(event);
  });

  await cleanScheduling();

  await createResource({
    externalRef: RESOURCE_REF,
    displayName: 'Ressource de test',
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 60,
    meetingLocation: { type: 'video', payload: { url: 'https://visio.test.local/salle' } },
  });
  // Tous les jours ouverts : le scénario ne doit pas dépendre du jour où il tourne.
  await setWeeklyRules(
    RESOURCE_REF,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  );
  await createTarget({ externalRef: TARGET_REF, resourceExternalRef: RESOURCE_REF });
});

afterAll(async () => {
  await cleanScheduling();
  registerEventConsumer(null);
  resetSchedulingConfig();
});

describe('S13.1 — émission de liens', () => {
  it('rend le MÊME jeton pour la même clé d’idempotence', async () => {
    const key = `idem-${suffix}`;
    const first = await createBookingLink({
      targetExternalRef: TARGET_REF,
      idempotencyKey: key,
      display: { title: 'Aperçu' },
    });
    const second = await createBookingLink({
      targetExternalRef: TARGET_REF,
      idempotencyKey: key,
      display: { title: 'Aperçu relu' },
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.token).toBe(first.token);
    expect(second.url).toBe(first.url);
  });

  it('ouvre une page de réservation et propose des créneaux', async () => {
    const token = await freshLink('page');
    const page = await resolveBookingPage(token);
    expect(page.status).toBe('open');
    expect(await slotsOf(token)).not.toHaveLength(0);
  });

  it('ferme la page dès que le lien est révoqué', async () => {
    const key = `revoke-${suffix}`;
    const { token } = await createBookingLink({
      targetExternalRef: TARGET_REF,
      idempotencyKey: key,
    });
    expect(await revokeLinkByKey(TARGET_REF, key, 'dossier clos')).toBe('revoked');

    const page = await resolveBookingPage(token);
    expect(page.status).toBe('gone');
    expect(await slotsOf(token)).toEqual([]);
  });
});

describe('S13.2 — concurrence sur un créneau', () => {
  it('ne laisse qu’UN gagnant quand deux invités confirment le même créneau', async () => {
    const [tokenA, tokenB] = await Promise.all([
      freshLink('race-a'),
      freshLink('race-b'),
    ]);
    const slot = (await slotsOf(tokenA))[0];
    expect(slot).toBeDefined();

    const [first, second] = await Promise.all([
      confirmBooking({ token: tokenA, startAt: slot!.startAt, attendee: attendee() }),
      confirmBooking({ token: tokenB, startAt: slot!.startAt, attendee: attendee() }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe('slot_taken');

    // Et la base le confirme : une seule réservation tient ce créneau.
    const { data } = await db()
      .from('sched_bookings')
      .select('id')
      .eq('start_at', slot!.startAt)
      .eq('status', 'confirmed');
    expect(data ?? []).toHaveLength(1);
  });
});

describe('S13.3 — compensations', () => {
  it('compense et ne laisse AUCUNE trace quand le lien est consommé entre-temps', async () => {
    // Deux confirmations simultanées avec le MÊME lien sur deux créneaux
    // différents : les deux réservations s'insèrent (créneaux distincts), mais
    // un seul des deux consomme le lien. Le perdant doit disparaître.
    const token = await freshLink('single-use');
    const slots = await slotsOf(token);
    expect(slots.length).toBeGreaterThan(1);

    const [first, second] = await Promise.all([
      confirmBooking({ token, startAt: slots[0]!.startAt, attendee: attendee() }),
      confirmBooking({ token, startAt: slots[1]!.startAt, attendee: attendee() }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe('link_gone');

    // Invariant vrai quel que soit l'entrelacement : un lien = une réservation,
    // et la ligne compensée a été SUPPRIMÉE (pas laissée annulée).
    const { data } = await db()
      .from('sched_bookings')
      .select('id, status')
      .eq('link_token', token);
    expect(data ?? []).toHaveLength(1);
    expect((data ?? [])[0]?.status).toBe('confirmed');
  });

  it('compense et REND le lien quand la cible est re-pointée pendant la confirmation', async () => {
    // Re-pointer sur la MÊME ressource suffit : la version bouge, les créneaux
    // restent valides — on isole ainsi la course, sans changer la disponibilité.
    let observed = false;

    for (let attempt = 0; attempt < 8 && !observed; attempt += 1) {
      const token = await freshLink(`repoint-${attempt}`);
      const slots = await slotsOf(token);
      const slot = slots[Math.min(attempt + 2, slots.length - 1)];
      if (!slot) break;

      const [result] = await Promise.all([
        confirmBooking({ token, startAt: slot.startAt, attendee: attendee() }),
        repointTarget(TARGET_REF, RESOURCE_REF),
      ]);

      const { data: rows } = await db()
        .from('sched_bookings')
        .select('id')
        .eq('link_token', token);
      const { data: link } = await db()
        .from('sched_booking_links')
        .select('status')
        .eq('token', token)
        .single();

      if (result.ok) {
        // Le re-pointage est passé avant ou après la séquence : état nominal.
        expect(rows ?? []).toHaveLength(1);
        expect(link?.status).toBe('used');
        continue;
      }

      expect(result.reason).toBe('target_changed');
      // Rien ne reste, et le lien est REDEVENU actif : l'invité recharge et
      // réserve chez le nouveau titulaire avec le même lien.
      expect(rows ?? []).toHaveLength(0);
      expect(link?.status).toBe('active');
      observed = true;
    }

    expect(
      observed,
      'la course re-pointage/confirmation ne s’est jamais produite en 8 tentatives',
    ).toBe(true);
  });
});

describe('S13.4 — événements', () => {
  it('émet booking.created une seule fois, et le drain ne relivre pas', async () => {
    const token = await freshLink('event-once');
    const slot = (await slotsOf(token)).at(-1);
    expect(slot).toBeDefined();

    const result = await confirmBooking({
      token,
      startAt: slot!.startAt,
      attendee: attendee(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const created = eventsFor(result.booking.id);
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('booking.created');
    // Le contexte de l'hôte revient TEL QUEL.
    expect(created[0]?.booking.context).toEqual({ probe: 'event-once' });
    expect(created[0]?.booking.meetingLocation).toEqual({
      type: 'video',
      payload: { url: 'https://visio.test.local/salle' },
    });

    await drainPendingEvents();
    expect(eventsFor(result.booking.id)).toHaveLength(1);
  });

  it('rattrape une réservation confirmée dont l’événement manque', async () => {
    const token = await freshLink('repair');
    const slots = await slotsOf(token);
    const slot = slots.at(-2);
    expect(slot).toBeDefined();

    const result = await confirmBooking({
      token,
      startAt: slot!.startAt,
      attendee: attendee(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // On simule le crash entre le claim et l'écriture de l'outbox.
    await db().from('sched_events').delete().eq('booking_id', result.booking.id);
    const before = eventsFor(result.booking.id).length;

    const drain = await drainPendingEvents();
    expect(drain.repaired).toBeGreaterThanOrEqual(1);
    expect(eventsFor(result.booking.id).length).toBe(before + 1);
    expect(eventsFor(result.booking.id).at(-1)?.type).toBe('booking.created');
  });
});

describe('S13.5 — cycle de vie du rendez-vous', () => {
  it('déplace un rendez-vous en gardant le lien de gestion valide', async () => {
    const token = await freshLink('reschedule');
    const slots = await slotsOf(token);
    const first = slots.at(3);
    const next = slots.at(4);
    expect(first && next).toBeTruthy();

    const confirmed = await confirmBooking({
      token,
      startAt: first!.startAt,
      attendee: attendee(),
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const moved = await rescheduleBooking(confirmed.manageToken, {
      startAt: next!.startAt,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    expect(moved.booking.startAt).toBe(next!.startAt);
    expect(moved.booking.rescheduledFrom).toBe(confirmed.booking.id);
    // Le jeton de gestion est REPORTÉ : les messages déjà reçus marchent encore.
    expect(moved.booking.manageToken).toBe(confirmed.manageToken);
    const resolved = await getBookingByManageToken(confirmed.manageToken);
    expect(resolved?.id).toBe(moved.booking.id);
    expect(resolved?.status).toBe('confirmed');

    // Un SEUL événement de déplacement, pas une annulation suivie d'une création.
    const events = eventsFor(moved.booking.id);
    expect(events.map((e) => e.type)).toEqual(['booking.rescheduled']);
    expect(events[0]?.booking.previousStartAt).toBe(first!.startAt);
  });

  it('annule un rendez-vous et émet booking.cancelled', async () => {
    const token = await freshLink('cancel');
    const slot = (await slotsOf(token)).at(6);
    expect(slot).toBeDefined();

    const confirmed = await confirmBooking({
      token,
      startAt: slot!.startAt,
      attendee: attendee(),
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    expect(await cancelBookingByAttendee(confirmed.manageToken, { reason: 'test' })).toBe(
      'cancelled',
    );
    expect(await cancelBookingByAttendee(confirmed.manageToken)).toBe('already_cancelled');

    const events = eventsFor(confirmed.booking.id);
    expect(events.at(-1)?.type).toBe('booking.cancelled');
    expect(events.at(-1)?.booking.cancelledBy).toBe('attendee');

    // Le créneau est de nouveau proposé à quelqu'un d'autre.
    const other = await freshLink('cancel-after');
    const reopened = await slotsOf(other);
    expect(reopened.some((s) => s.startAt === slot!.startAt)).toBe(true);
  });
});

describe('S13.6 — cible sans ressource', () => {
  it('affiche une page dégradée plutôt qu’une erreur', async () => {
    const orphanRef = `${REF_PREFIX}orphan-${suffix}`;
    await createTarget({ externalRef: orphanRef });
    const { token } = await createBookingLink({
      targetExternalRef: orphanRef,
      idempotencyKey: `orphan-${suffix}`,
      display: { title: 'Entretien' },
    });

    const page = await resolveBookingPage(token);
    expect(page.status).toBe('degraded');
    expect(await listSlotsForLink(token, WINDOW())).toEqual([]);

    // Et une confirmation tentée malgré tout est refusée proprement.
    const result = await confirmBooking({
      token,
      startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      attendee: attendee(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('resource_unavailable');
  });
});
