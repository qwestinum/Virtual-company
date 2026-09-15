/**
 * S26 — Agenda externe : copie en base, tolérance, suspension, alerte (lot B).
 *
 * Routes RÉELLES en-process, base DEV, table `recruiter_busy_snapshots` et
 * journal RÉELS. Seuls l'agenda (réponses HTTP scriptées) et le transport
 * d'email (enregistreur de la suite) sont simulés.
 *
 * Ce que ce scénario protège :
 *
 *   1. une lecture réussie ÉCRIT la copie (bornes seulement) ;
 *   2. TOLÉRANCE : agenda muet, dernière lecture de moins de 2 h ouvrées —
 *      la confirmation passe SUR LA COPIE (un créneau occupé dans la copie
 *      reste refusé) et la réservation porte `availability_check = snapshot` ;
 *   3. SUSPENSION : au-delà — la page de créneaux dit `unavailable`, la
 *      confirmation rend 503, rien n'est écrit ;
 *   4. ALERTE : UN email au recruteur à l'entrée en suspension, même si les
 *      lectures en échec se répètent ; transitions journalisées une fois ;
 *      le signal métier s'allume, et tout s'éteint au rétablissement ;
 *   5. changer l'URL de l'agenda OUBLIE la copie.
 *
 * Le temps OUVRÉ est rendu déterministe sans figer l'horloge : « il y a 10 min »
 * vaut au plus 10 min ouvrées, « il y a 3 jours » vaut au moins 27 h ouvrées
 * sur une grille 9h-18h tous les jours — quelle que soit l'heure du lancement.
 *
 * ⚠️ Migration du lot B à appliquer en DEV (`recruiter_busy_snapshots`).
 *
 * Marqueurs de purge : cibles `SCHED-TREG26-`, recruteur `*.s26@test.local`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fetchBusyCalendar } from '@/lib/calendar/busy-ics/fetch';
import {
  getBusySnapshot,
  recordBusyReadFailure,
  recordBusyReadSuccess,
} from '@/lib/db/repos/busy-snapshots';
import { patchRecruiter } from '@/lib/db/repos/recruiters';
import { computeBusinessSignals } from '@/lib/notifications/business-signals';
import {
  configureScheduling,
  createBookingLink,
  createRecordingMailer,
  createResource,
  createTarget,
  registerEventConsumer,
  resetSchedulingConfig,
  setWeeklyRules,
  type Slot,
} from '@/lib/scheduling';
import { BUSY_CALENDAR_STATE_ACTION, createBusyCalendarObserver } from '@/lib/scheduling-host/busy/notify';
import { createIcsBusyProvider } from '@/lib/scheduling-host/busy/provider';

import { GET as slotsRoute } from '@/app/api/sched/links/[token]/slots/route';
import { POST as bookRoute } from '@/app/api/sched/links/[token]/book/route';

import { setBusyCalendarCabinet } from './helpers/busy-calendar';
import { db } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const PREFIX = 'SCHED-TREG26-';
const suffix = Math.random().toString(36).slice(2, 8);
const RECRUITER_ID = randomUUID();
const RECRUITER_EMAIL = `camille-${suffix}.s26@test.local`;
const TARGET = `${PREFIX}tgt-${suffix}`;
const SECRET = 'SECRET-TOKEN-S26';
const CALENDAR_URL = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${SECRET}/cid-0/calendar.ics`;

// ─── Agenda scripté ─────────────────────────────────────────────────────

const toIcsUtc = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const feed = (busy: Slot[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...busy.flatMap((slot, i) => [
      'BEGIN:VEVENT',
      `UID:s26-${i}`,
      'SUMMARY;LANGUAGE=fr-FR:Occupé(e)',
      `DTSTART:${toIcsUtc(slot.startAt)}`,
      `DTEND:${toIcsUtc(slot.endAt)}`,
      'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

let agenda: { kind: 'live'; busy: Slot[] } | { kind: 'unpublished' } = { kind: 'live', busy: [] };

const fetchImpl = (async (input: string | URL | Request) => {
  if (agenda.kind === 'live') {
    return new Response(feed(agenda.busy), {
      status: 200,
      headers: { 'content-type': 'text/calendar; charset=utf-8' },
    });
  }
  // Forme MESURÉE d'une URL Outlook dépubliée.
  return String(input).includes('errorFE.aspx')
    ? new Response('<!DOCTYPE html><html>GetAnonymousCalendarSessionData failed</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    : new Response(null, { status: 302, headers: { location: '/owa/auth/errorFE.aspx?httpCode=404' } });
}) as typeof fetch;

// ─── Requêtes ───────────────────────────────────────────────────────────

let ip = 0;
function req(url: string, init?: RequestInit): Request {
  ip += 1;
  const headers = new Headers(init?.headers);
  headers.set('x-forwarded-for', `10.26.${Math.floor(ip / 250)}.${(ip % 250) + 1}`);
  return new Request(url, { ...init, headers });
}

async function offer(token: string): Promise<{ slots: Slot[]; unavailable: boolean }> {
  const from = new Date(Date.now() + 60_000).toISOString();
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const response = await slotsRoute(
    req(`https://treg.test/api/sched/links/${token}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    { params: Promise.resolve({ token }) },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { slots: Slot[]; unavailable: boolean };
}

async function book(token: string, startAt: string) {
  const response = await bookRoute(
    req(`https://treg.test/api/sched/links/${token}/book`, {
      method: 'POST',
      body: JSON.stringify({
        startAt,
        attendee: { name: 'Alex Martin', email: `alex-${suffix}.s26@test.local`, timezone: 'Europe/Paris' },
      }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function link(key: string): Promise<string> {
  return (
    await createBookingLink({ targetExternalRef: TARGET, idempotencyKey: `${key}-${suffix}`, display: { title: 'Entretien' } })
  ).token;
}

async function bookingRow(token: string) {
  const { data } = await db().from('sched_bookings').select('*').eq('link_token', token);
  return (data ?? []) as Record<string, unknown>[];
}

/** Recule la dernière lecture réussie : c'est l'âge de la copie qui décide. */
async function ageCopy(ms: number): Promise<void> {
  const { error } = await db()
    .from('recruiter_busy_snapshots')
    .update({ read_at: new Date(Date.now() - ms).toISOString(), attempted_at: new Date(Date.now() - ms).toISOString() })
    .eq('recruiter_id', RECRUITER_ID);
  expect(error).toBeNull();
}

async function transitions(): Promise<{ from: unknown; to: unknown }[]> {
  const { data } = await db()
    .from('journal')
    .select('payload, created_at')
    .eq('action', BUSY_CALENDAR_STATE_ACTION)
    .filter('payload->>recruiterId', 'eq', RECRUITER_ID)
    .order('created_at', { ascending: true });
  return ((data ?? []) as { payload: { from: unknown; to: unknown } }[]).map((r) => ({
    from: r.payload.from,
    to: r.payload.to,
  }));
}

const blockedEmails = () => sentEmails.filter((m) => m.subject.includes('ne sont plus proposés'));

// ─── Mise en place ──────────────────────────────────────────────────────

function useConnector(): void {
  configureScheduling({
    supabase: db(),
    mailer: createRecordingMailer(),
    publicBaseUrl: 'https://treg.test.local',
    busyProvider: createIcsBusyProvider({
      loadCalendarUrl: async () => ({ kind: 'url', url: CALENDAR_URL }),
      fetchCalendar: (url) => fetchBusyCalendar(url, { fetchImpl }),
      store: { get: getBusySnapshot, recordSuccess: recordBusyReadSuccess, recordFailure: recordBusyReadFailure },
      observe: createBusyCalendarObserver({ settingsUrl: () => 'https://treg.test.local/settings' }),
    }),
  });
}

async function clean(): Promise<void> {
  const supabase = db();
  const { data: targets } = await supabase.from('sched_targets').select('id').like('external_ref', `${PREFIX}%`);
  const targetIds = (targets ?? []).map((r) => r.id as string);
  if (targetIds.length > 0) {
    const { data: bookings } = await supabase.from('sched_bookings').select('id').in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((r) => r.id as string);
    if (bookingIds.length > 0) await supabase.from('sched_events').delete().in('booking_id', bookingIds);
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: recruiters } = await supabase.from('recruiters').select('id').like('email', '%.s26@test.local');
  const ids = (recruiters ?? []).map((r) => r.id as string);
  for (const id of ids) {
    const { data: resources } = await supabase.from('sched_resources').select('id').eq('external_ref', id);
    const resourceIds = (resources ?? []).map((r) => r.id as string);
    if (resourceIds.length > 0) {
      await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
      await supabase.from('sched_resources').delete().in('id', resourceIds);
    }
    await supabase.from('journal').delete().filter('payload->>recruiterId', 'eq', id).like('action', 'busy_calendar_%');
    await supabase.from('imap_outreach_claims').delete().eq('mailbox_id', 'busy_calendar_blocked').like('uid', `${id}|%`);
  }
  if (ids.length > 0) await supabase.from('recruiters').delete().in('id', ids);
}

let restoreCabinet: () => Promise<void> = async () => {};

beforeAll(async () => {
  process.env.BUSY_CALENDAR_ENABLED = '1';
  // Second étage du flag (lot D) : sans l'accord du cabinet, ni relève ni signal.
  restoreCabinet = await setBusyCalendarCabinet(true);
  useConnector();
  registerEventConsumer(async () => {});
  await clean();

  const probe = await db().from('recruiter_busy_snapshots').select('recruiter_id').limit(1);
  if (probe.error) {
    throw new Error(`migration du lot B non appliquée en DEV (recruiter_busy_snapshots) : ${probe.error.message}`);
  }

  const inserted = await db().from('recruiters').insert({
    id: RECRUITER_ID,
    display_name: 'Camille Test',
    email: RECRUITER_EMAIL,
    role: 'member',
    is_active: true,
  });
  expect(inserted.error).toBeNull();

  await createResource({
    externalRef: RECRUITER_ID,
    displayName: 'Camille Test',
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 30,
    meetingLocation: { type: 'video', payload: { url: 'https://visio.test.local/salle' } },
    notifyEmail: RECRUITER_EMAIL,
  });
  await setWeeklyRules(
    RECRUITER_ID,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 18 * 60 })),
  );
  await createTarget({ externalRef: TARGET, resourceExternalRef: RECRUITER_ID });
});

beforeEach(() => {
  useConnector();
});

afterAll(async () => {
  await restoreCabinet();
  await clean();
  delete process.env.BUSY_CALENDAR_ENABLED;
  registerEventConsumer(null);
  resetSchedulingConfig();
});

// ─── Scénarios (séquentiels : chaque étape part de l'état de la précédente) ──

describe('S26 — de la lecture saine à la suspension, et retour', () => {
  let slots: Slot[] = [];

  it('S26.1 — une lecture réussie écrit la copie, bornes seulement, sans rien journaliser', async () => {
    agenda = { kind: 'live', busy: [] };
    const token = await link('seed');
    slots = (await offer(token)).slots;
    agenda = { kind: 'live', busy: [slots[4] as Slot] };
    // La confirmation relit : la copie reflète maintenant la plage occupée.
    expect((await book(token, (slots[4] as Slot).startAt)).response.status).toBe(409);

    const copy = await getBusySnapshot(RECRUITER_ID);
    expect(copy).toMatchObject({
      intervals: [{ startAt: (slots[4] as Slot).startAt, endAt: (slots[4] as Slot).endAt }],
      failingSince: null,
      failureCode: null,
      lastState: 'healthy',
    });
    const { data } = await db().from('recruiter_busy_snapshots').select('*').eq('recruiter_id', RECRUITER_ID).single();
    expect(JSON.stringify(data)).not.toMatch(/Occupé|SECRET|outlook/);
    expect(await transitions()).toEqual([]);
  });

  it('S26.2 — TOLÉRANCE : agenda dépublié depuis peu, la réservation passe sur la copie et le porte', async () => {
    await ageCopy(10 * 60_000);
    agenda = { kind: 'unpublished' };
    resetSentEmails();

    // Un créneau occupé DANS LA COPIE reste refusé.
    const refused = await book(await link('tol-busy'), (slots[4] as Slot).startAt);
    expect(refused.response.status).toBe(409);

    const token = await link('tol-ok');
    const accepted = await book(token, (slots[7] as Slot).startAt);
    expect(accepted.response.status).toBe(200);
    expect((await bookingRow(token))[0]).toMatchObject({ availability_check: 'snapshot' });

    expect(await getBusySnapshot(RECRUITER_ID)).toMatchObject({ failureCode: 'not_calendar' });
    expect(await transitions()).toEqual([{ from: 'healthy', to: 'tolerated' }]);
    expect(blockedEmails()).toEqual([]);
  });

  it('S26.3 — SUSPENSION : au-delà de 2 h ouvrées, 503, page indisponible, UN email', async () => {
    await ageCopy(3 * 86_400_000);
    resetSentEmails();

    const token = await link('blocked');
    const refused = await book(token, (slots[9] as Slot).startAt);
    expect(refused.response.status).toBe(503);
    expect(refused.payload.reason).toBe('availability_unverified');
    expect(await bookingRow(token)).toEqual([]);

    expect(await offer(token)).toEqual({ slots: [], unavailable: true });

    // Les lectures en échec se répètent : ni seconde transition, ni second email.
    await book(token, (slots[10] as Slot).startAt);
    expect(await transitions()).toEqual([
      { from: 'healthy', to: 'tolerated' },
      { from: 'tolerated', to: 'blocked' },
    ]);
    const mails = blockedEmails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual([RECRUITER_EMAIL]);
    expect(mails[0]!.html).toContain('Republie ton agenda');
    expect(mails[0]!.html).not.toContain(SECRET);
  });

  it('S26.4 — le signal métier s’allume pour CE recruteur seulement', async () => {
    const mine = (await computeBusinessSignals(Date.now(), { recruiterId: RECRUITER_ID })).find(
      (s) => s.key === 'busy_calendar_unreadable',
    );
    expect(mine?.message).toContain('ne sont plus proposés');
    expect(mine?.target).toEqual({ route: '/settings' });
    const other = await computeBusinessSignals(Date.now(), { recruiterId: randomUUID() });
    expect(other.find((s) => s.key === 'busy_calendar_unreadable')).toBeUndefined();
  });

  it('S26.5 — RÉTABLISSEMENT : la confirmation relit, tout s’éteint', async () => {
    agenda = { kind: 'live', busy: [] };
    const token = await link('recovered');
    const accepted = await book(token, (slots[11] as Slot).startAt);
    expect(accepted.response.status).toBe(200);
    expect((await bookingRow(token))[0]).toMatchObject({ availability_check: 'live' });

    expect(await getBusySnapshot(RECRUITER_ID)).toMatchObject({ failingSince: null, lastState: 'healthy' });
    expect((await transitions()).at(-1)).toEqual({ from: 'blocked', to: 'healthy' });
    expect((await offer(await link('after'))).unavailable).toBe(false);
    const signals = await computeBusinessSignals(Date.now(), { recruiterId: RECRUITER_ID });
    expect(signals.find((s) => s.key === 'busy_calendar_unreadable')).toBeUndefined();
  });

  it('S26.6 — changer l’URL de l’agenda oublie la copie', async () => {
    expect(await getBusySnapshot(RECRUITER_ID)).not.toBeNull();
    await patchRecruiter(RECRUITER_ID, {
      busyIcsUrl: 'https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/autre/calendar.ics',
    });
    expect(await getBusySnapshot(RECRUITER_ID)).toBeNull();
    const { data } = await db().from('recruiters').select('busy_ics_url').eq('id', RECRUITER_ID).single();
    expect((data as { busy_ics_url: string }).busy_ics_url).not.toContain('outlook');
  });
});
