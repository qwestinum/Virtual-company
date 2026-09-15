/**
 * S25 — Agenda externe : relecture À LA CONFIRMATION (lot A).
 *
 * Les handlers de routes RÉELS sont invoqués en-process, contre la base DEV.
 * Ce que ce scénario protège, dans l'ordre d'importance :
 *
 *   1. un créneau PROPOSÉ puis devenu occupé dans l'agenda externe est refusé
 *      à la confirmation — 409 `invalid_slot`, la même mécanique que la course
 *      entre deux invités — et AUCUNE réservation n'est écrite ;
 *   2. la confirmation relit la source EN DIRECT (`live`), pas l'offre ;
 *   3. une source illisible au moment de confirmer ne confirme PAS à l'aveugle :
 *      503 `availability_unverified`, le lien reste utilisable ;
 *   4. un déplacement est une confirmation : même relecture, et le rendez-vous
 *      d'origine reste intact quand le nouveau créneau est pris ailleurs ;
 *   5. la chaîne RÉELLE de l'hôte (lecture HTTP à règle d'acceptation +
 *      parseur) produit les mêmes verdicts sur des flux de la forme Outlook
 *      mesurée le 15/09 : vivant 200 text/calendar, dépublié 302 → HTML.
 *
 * La source est injectée par le port (`configureScheduling({ busyProvider })`).
 * Aucun réseau : la lecture HTTP reçoit un `fetch` scripté.
 *
 * ⚠️ S25.5 lit `sched_bookings.availability_check` : la migration du lot A
 * doit être appliquée en DEV (double application de scripts/migrate.sql).
 *
 * Marqueur de purge : `SCHED-TREG25-`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fetchBusyCalendar } from '@/lib/calendar/busy-ics/fetch';
import {
  configureScheduling,
  createBookingLink,
  createRecordingMailer,
  createResource,
  createTarget,
  registerEventConsumer,
  resetSchedulingConfig,
  setWeeklyRules,
  type BusyInterval,
  type ExternalBusyAnswer,
  type ExternalBusyRequest,
  type Slot,
} from '@/lib/scheduling';
import { createIcsBusyProvider } from '@/lib/scheduling-host/busy/provider';

import { GET as slotsRoute } from '@/app/api/sched/links/[token]/slots/route';
import { POST as bookRoute } from '@/app/api/sched/links/[token]/book/route';
import { POST as rescheduleRoute } from '@/app/api/sched/bookings/[manageToken]/reschedule/route';

import { db } from './helpers/db';

const PREFIX = 'SCHED-TREG25-';
const suffix = Math.random().toString(36).slice(2, 8);
const RESOURCE = `${PREFIX}res-${suffix}`;
const TARGET = `${PREFIX}tgt-${suffix}`;

// ─── Source injectée, pilotée par le test ───────────────────────────────

type SourceMode =
  | { kind: 'free' }
  | { kind: 'busy'; intervals: BusyInterval[] }
  | { kind: 'unavailable' }
  | { kind: 'throws' }
  | { kind: 'not_configured' };

let mode: SourceMode = { kind: 'free' };
const reads: ExternalBusyRequest[] = [];

const scriptedProvider = {
  async read(request: ExternalBusyRequest): Promise<ExternalBusyAnswer> {
    reads.push(request);
    switch (mode.kind) {
      case 'free':
        return { kind: 'ok', intervals: [], readAt: new Date().toISOString() };
      case 'busy':
        return { kind: 'ok', intervals: mode.intervals, readAt: new Date().toISOString() };
      case 'unavailable':
        return { kind: 'unavailable', lastGood: null, failingSince: new Date().toISOString() };
      case 'throws':
        throw new Error('source en panne');
      case 'not_configured':
        return { kind: 'not_configured' };
    }
  },
};

function useProvider(provider: { read(r: ExternalBusyRequest): Promise<ExternalBusyAnswer> }): void {
  configureScheduling({
    supabase: db(),
    mailer: createRecordingMailer(),
    publicBaseUrl: 'https://treg.test.local',
    organizationName: 'Cabinet Test',
    busyProvider: provider,
  });
}

// ─── Requêtes ───────────────────────────────────────────────────────────

let ipCounter = 0;
function req(url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  // Une adresse par requête : on mesure la relecture, pas la limitation de débit.
  ipCounter += 1;
  headers.set('x-forwarded-for', `10.25.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`);
  return new Request(url, { ...init, headers });
}

async function fetchSlots(token: string): Promise<Slot[]> {
  const from = new Date(Date.now() + 60_000).toISOString();
  const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const response = await slotsRoute(
    req(`https://treg.test/api/sched/links/${token}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    { params: Promise.resolve({ token }) },
  );
  if (!response.ok) return [];
  return ((await response.json()) as { slots: Slot[] }).slots;
}

async function book(token: string, startAt: string) {
  const response = await bookRoute(
    req(`https://treg.test/api/sched/links/${token}/book`, {
      method: 'POST',
      body: JSON.stringify({
        startAt,
        attendee: { name: 'Alex Martin', email: `alex-${suffix}@test.local`, timezone: 'Europe/Paris' },
      }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function reschedule(manageToken: string, startAt: string) {
  const response = await rescheduleRoute(
    req(`https://treg.test/api/sched/bookings/${manageToken}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ startAt }),
    }),
    { params: Promise.resolve({ manageToken }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function link(key: string): Promise<string> {
  const created = await createBookingLink({
    targetExternalRef: TARGET,
    idempotencyKey: `${key}-${suffix}`,
    display: { title: 'Entretien' },
  });
  return created.token;
}

async function bookingsOf(token: string) {
  const { data, error } = await db()
    .from('sched_bookings')
    .select('*')
    .eq('link_token', token);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

async function linkStatus(token: string): Promise<string> {
  const { data } = await db().from('sched_booking_links').select('status').eq('token', token).single();
  return (data as { status: string }).status;
}

const covering = (slot: Slot): BusyInterval[] => [{ startAt: slot.startAt, endAt: slot.endAt }];

// ─── Mise en place / nettoyage ──────────────────────────────────────────

async function cleanScheduling(): Promise<void> {
  const supabase = db();
  const { data: targets } = await supabase.from('sched_targets').select('id').like('external_ref', `${PREFIX}%`);
  const targetIds = (targets ?? []).map((row) => row.id as string);
  if (targetIds.length > 0) {
    const { data: bookings } = await supabase.from('sched_bookings').select('id').in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((row) => row.id as string);
    if (bookingIds.length > 0) await supabase.from('sched_events').delete().in('booking_id', bookingIds);
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: resources } = await supabase.from('sched_resources').select('id').like('external_ref', `${PREFIX}%`);
  const resourceIds = (resources ?? []).map((row) => row.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase.from('sched_availability_exceptions').delete().in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
}

beforeAll(async () => {
  useProvider(scriptedProvider);
  registerEventConsumer(async () => {});
  await cleanScheduling();
  await createResource({
    externalRef: RESOURCE,
    displayName: 'Camille Test',
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 60,
    meetingLocation: { type: 'video', payload: { url: 'https://visio.test.local/salle' } },
    notifyEmail: `camille-${suffix}@test.local`,
  });
  await setWeeklyRules(
    RESOURCE,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 18 * 60 })),
  );
  await createTarget({ externalRef: TARGET, resourceExternalRef: RESOURCE });
});

beforeEach(() => {
  useProvider(scriptedProvider);
  mode = { kind: 'free' };
  reads.length = 0;
});

afterAll(async () => {
  await cleanScheduling();
  registerEventConsumer(null);
  resetSchedulingConfig();
});

// ─── Scénarios ──────────────────────────────────────────────────────────

describe('S25.1 — créneau proposé puis devenu occupé ⇒ 409', () => {
  it('refuse la confirmation, n’écrit rien, et laisse le lien utilisable', async () => {
    const token = await link('became-busy');
    const slots = await fetchSlots(token);
    const chosen = slots[3] as Slot;
    expect(chosen).toBeDefined();

    // Entre l'affichage et le clic, une réunion est posée sur ce créneau.
    mode = { kind: 'busy', intervals: covering(chosen) };
    reads.length = 0;
    const refused = await book(token, chosen.startAt);

    expect(refused.response.status).toBe(409);
    expect(refused.payload.reason).toBe('invalid_slot');
    expect(await bookingsOf(token)).toEqual([]);
    expect(await linkStatus(token)).toBe('active');

    // La confirmation a RELU la source, en direct — pas l'offre affichée.
    expect(reads.map((r) => r.freshness)).toEqual(['live']);
    expect(Date.parse(reads[0]!.from)).toBeLessThanOrEqual(Date.parse(chosen.startAt));
    expect(Date.parse(reads[0]!.to)).toBeGreaterThanOrEqual(Date.parse(chosen.endAt));

    // La grille rechargée ne propose plus ce créneau ; un autre se réserve.
    const reloaded = await fetchSlots(token);
    expect(reloaded.map((s) => s.startAt)).not.toContain(chosen.startAt);
    const other = reloaded[3] as Slot;
    const accepted = await book(token, other.startAt);
    expect(accepted.response.status).toBe(200);
  });

  it('l’offre soustrait déjà ce que la source connaît', async () => {
    const token = await link('offer');
    const before = await fetchSlots(token);
    const hidden = before[2] as Slot;
    mode = { kind: 'busy', intervals: covering(hidden) };
    reads.length = 0;
    const after = await fetchSlots(token);
    expect(after.map((s) => s.startAt)).not.toContain(hidden.startAt);
    expect(reads.map((r) => r.freshness)).toEqual(['snapshot']);
  });
});

describe('S25.2 — source illisible au moment de confirmer', () => {
  it.each([['unavailable' as const], ['throws' as const]])(
    '%s : 503 availability_unverified, rien d’écrit, lien intact',
    async (kind) => {
      const token = await link(`unverified-${kind}`);
      const chosen = (await fetchSlots(token))[4] as Slot;

      mode = { kind };
      const refused = await book(token, chosen.startAt);
      expect(refused.response.status).toBe(503);
      expect(refused.payload.reason).toBe('availability_unverified');
      expect(await bookingsOf(token)).toEqual([]);
      expect(await linkStatus(token)).toBe('active');

      // La source revient : le même lien réserve le même créneau.
      mode = { kind: 'free' };
      expect((await book(token, chosen.startAt)).response.status).toBe(200);
    },
  );

  it('n’offre aucun créneau tant que la source est illisible', async () => {
    const token = await link('offer-unverified');
    mode = { kind: 'unavailable' };
    expect(await fetchSlots(token)).toEqual([]);
  });
});

describe('S25.3 — un déplacement relit aussi la source', () => {
  it('refuse le nouveau créneau devenu occupé et garde le rendez-vous d’origine', async () => {
    const token = await link('reschedule');
    const slots = await fetchSlots(token);
    const original = slots[5] as Slot;
    const target = slots[8] as Slot;
    const booked = await book(token, original.startAt);
    expect(booked.response.status).toBe(200);
    const manageUrl = booked.payload.manageUrl as string;
    const manageToken = manageUrl.split('/').pop() as string;

    mode = { kind: 'busy', intervals: covering(target) };
    reads.length = 0;
    const refused = await reschedule(manageToken, target.startAt);
    expect(refused.response.status).toBe(409);
    expect(refused.payload.reason).toBe('invalid_slot');
    expect(reads.map((r) => r.freshness)).toEqual(['live']);

    const rows = await bookingsOf(token);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'confirmed' });
    expect(Date.parse(rows[0]!.start_at as string)).toBe(Date.parse(original.startAt));

    mode = { kind: 'unavailable' };
    const unverified = await reschedule(manageToken, target.startAt);
    expect(unverified.response.status).toBe(503);
    expect(unverified.payload.reason).toBe('availability_unverified');
    expect((await bookingsOf(token)).filter((r) => r.status === 'confirmed')).toHaveLength(1);
  });
});

describe('S25.4 — chaîne réelle de l’hôte (forme Outlook mesurée)', () => {
  const SECRET = 'SECRET-TOKEN-S25';
  const URL_OUTLOOK = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${SECRET}/cid-0/calendar.ics`;
  let served: () => Response = () => new Response(null, { status: 500 });

  const toIcsUtc = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const outlookFeed = (busy: Slot[]) =>
    [
      'BEGIN:VCALENDAR',
      'METHOD:PUBLISH',
      'PRODID:Microsoft Exchange Server 2010',
      'VERSION:2.0',
      ...busy.flatMap((slot, i) => [
        'BEGIN:VEVENT',
        `UID:0400000082${i}`,
        'SUMMARY;LANGUAGE=fr-FR:Occupé(e)',
        `DTSTART:${toIcsUtc(slot.startAt)}`,
        `DTEND:${toIcsUtc(slot.endAt)}`,
        'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
      '',
    ].join('\r\n');

  const fetchImpl = (async () => served()) as typeof fetch;

  beforeEach(() => {
    useProvider(
      createIcsBusyProvider({
        loadCalendarUrl: async () => ({ kind: 'url', url: URL_OUTLOOK }),
        fetchCalendar: (url) => fetchBusyCalendar(url, { fetchImpl }),
      }),
    );
  });

  it('flux vivant : le créneau occupé est refusé, les autres se réservent', async () => {
    const token = await link('host-live');
    served = () =>
      new Response(outlookFeed([]), { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } });
    const slots = await fetchSlots(token);
    const chosen = slots[6] as Slot;

    served = () =>
      new Response(outlookFeed([chosen]), {
        status: 200,
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
      });
    const refused = await book(token, chosen.startAt);
    expect(refused.response.status).toBe(409);
    expect(refused.payload.reason).toBe('invalid_slot');
    expect(await bookingsOf(token)).toEqual([]);

    const accepted = await book(token, (slots[9] as Slot).startAt);
    expect(accepted.response.status).toBe(200);
  });

  it('URL dépubliée (302 → page HTML d’erreur) : jamais confirmé, jamais l’URL dans la réponse', async () => {
    const token = await link('host-unpublished');
    served = () =>
      new Response(outlookFeed([]), { status: 200, headers: { 'content-type': 'text/calendar' } });
    const chosen = (await fetchSlots(token))[7] as Slot;

    let hop = 0;
    served = () =>
      hop++ % 2 === 0
        ? new Response(null, { status: 302, headers: { location: 'https://outlook.live.com/owa/error.aspx' } })
        : new Response('<!DOCTYPE html><html>GetAnonymousCalendarSessionData failed</html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    const refused = await book(token, chosen.startAt);
    expect(refused.response.status).toBe(503);
    expect(refused.payload.reason).toBe('availability_unverified');
    expect(JSON.stringify(refused.payload)).not.toContain(SECRET);
    expect(await bookingsOf(token)).toEqual([]);
  });

  it('agenda vide : cas valide, la réservation passe', async () => {
    const token = await link('host-empty');
    served = () =>
      new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', {
        status: 200,
        headers: { 'content-type': 'text/calendar' },
      });
    const chosen = (await fetchSlots(token))[10] as Slot;
    expect((await book(token, chosen.startAt)).response.status).toBe(200);
  });
});

describe('S25.5 — trace de la vérification sur la réservation', () => {
  it('écrit `live` quand la source a été relue, `none` sans source', async () => {
    const probe = await db().from('sched_bookings').select('availability_check').limit(1);
    if (probe.error) {
      throw new Error(
        `migration du lot A non appliquée en DEV (sched_bookings.availability_check) : ${probe.error.message}`,
      );
    }

    const live = await link('trace-live');
    const liveSlot = (await fetchSlots(live))[11] as Slot;
    expect((await book(live, liveSlot.startAt)).response.status).toBe(200);
    expect((await bookingsOf(live))[0]).toMatchObject({ availability_check: 'live' });

    mode = { kind: 'not_configured' };
    const none = await link('trace-none');
    const noneSlot = (await fetchSlots(none))[12] as Slot;
    expect((await book(none, noneSlot.startAt)).response.status).toBe(200);
    expect((await bookingsOf(none))[0]).toMatchObject({ availability_check: 'none' });
  });
});
