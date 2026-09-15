/**
 * S27 — Agenda externe : relève périodique SANS AUCUNE VISITE (lot C).
 *
 * La route RÉELLE `/api/cron/busy-calendars` est appelée comme le ferait
 * cron-job.org, contre la base DEV. AUCUNE page candidat n'est ouverte, AUCUNE
 * réservation n'est tentée : c'est précisément le cas que le lot B ne couvrait
 * pas — une URL morte sans visite ne prévenait personne.
 *
 * Ce que ce scénario protège :
 *   1. la relève lit l'agenda et écrit sa copie ;
 *   2. dépublié : l'état avance à chaque passe — toléré, puis suspendu ;
 *   3. à la suspension : UN email, UN signal, une transition — pas une par passe ;
 *   4. une redirection hors des domaines du fournisseur est journalisée À PART,
 *      une fois par série, avec l'hôte seulement ;
 *   5. rétablissement par la relève seule ;
 *   6. deux passes simultanées ne lisent pas deux fois le même agenda ;
 *   7. connecteur éteint : la route répond sans rien lire.
 *
 * ⚠️ Migrations des lots B et C à appliquer en DEV.
 *
 * Marqueur de purge : recruteur `*.s27@test.local`.
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
  createRecordingMailer,
  createResource,
  registerEventConsumer,
  resetSchedulingConfig,
  setWeeklyRules,
} from '@/lib/scheduling';
import {
  BUSY_CALENDAR_REDIRECT_REFUSED_ACTION,
  BUSY_CALENDAR_STATE_ACTION,
  createBusyCalendarObserver,
} from '@/lib/scheduling-host/busy/notify';
import { createIcsBusyProvider } from '@/lib/scheduling-host/busy/provider';

import { GET as cronRoute } from '@/app/api/cron/busy-calendars/route';

import { db } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const suffix = Math.random().toString(36).slice(2, 8);
const RECRUITER_ID = randomUUID();
const RECRUITER_EMAIL = `camille-${suffix}.s27@test.local`;
const SECRET = 'SECRET-TOKEN-S27';
const CALENDAR_URL = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${SECRET}/cid-0/calendar.ics`;
const CRON = 's27-cron-secret';

// ─── Agenda scripté ─────────────────────────────────────────────────────

type Agenda = 'live' | 'unpublished' | 'hijacked';
let agenda: Agenda = 'live';
let fetches = 0;

const LIVE_FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:s27',
  'SUMMARY;LANGUAGE=fr-FR:Occupé(e)',
  'DTSTART:20260101T090000Z',
  'DTEND:20260101T100000Z',
  'RRULE:FREQ=DAILY',
  'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const fetchImpl = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes(SECRET)) fetches += 1;
  if (agenda === 'live') {
    return new Response(LIVE_FEED, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } });
  }
  if (agenda === 'hijacked') {
    return new Response(null, { status: 302, headers: { location: `https://collecte.attaquant.test/${SECRET}` } });
  }
  return url.includes('errorFE.aspx')
    ? new Response('<!DOCTYPE html><html>GetAnonymousCalendarSessionData failed</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    : new Response(null, { status: 302, headers: { location: '/owa/auth/errorFE.aspx?httpCode=404' } });
}) as typeof fetch;

// ─── Outils ─────────────────────────────────────────────────────────────

async function runCron(): Promise<Record<string, unknown>> {
  const response = await cronRoute(
    new Request('https://treg.test/api/cron/busy-calendars', { headers: { authorization: `Bearer ${CRON}` } }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** Vieillit la dernière lecture réussie et libère la réservation de relève (passe suivante immédiate). */
async function ageCopy(ms: number): Promise<void> {
  const at = new Date(Date.now() - ms).toISOString();
  const { error } = await db()
    .from('recruiter_busy_snapshots')
    .update({ read_at: at, attempted_at: at, refresh_claimed_at: null })
    .eq('recruiter_id', RECRUITER_ID);
  expect(error).toBeNull();
}

async function releaseClaim(): Promise<void> {
  await db().from('recruiter_busy_snapshots').update({ refresh_claimed_at: null }).eq('recruiter_id', RECRUITER_ID);
}

async function journal(action: string): Promise<Record<string, unknown>[]> {
  const { data } = await db()
    .from('journal')
    .select('payload, created_at')
    .eq('action', action)
    .filter('payload->>recruiterId', 'eq', RECRUITER_ID)
    .order('created_at', { ascending: true });
  return ((data ?? []) as { payload: Record<string, unknown> }[]).map((r) => r.payload);
}

const blockedEmails = () => sentEmails.filter((m) => m.subject.includes('ne sont plus proposés'));
const signal = async () =>
  (await computeBusinessSignals(Date.now(), { recruiterId: RECRUITER_ID })).find(
    (s) => s.key === 'busy_calendar_unreadable',
  );

function useConnector(): void {
  configureScheduling({
    supabase: db(),
    mailer: createRecordingMailer(),
    publicBaseUrl: 'https://treg.test.local',
    busyProvider: createIcsBusyProvider({
      // Seul NOTRE recruteur a un agenda pour cette source : un autre
      // recruteur de la base DEV qui en déclarerait un n'est jamais lu ici.
      loadCalendarUrl: async (id) => (id === RECRUITER_ID ? { kind: 'url', url: CALENDAR_URL } : { kind: 'none' }),
      fetchCalendar: (url) => fetchBusyCalendar(url, { fetchImpl }),
      store: { get: getBusySnapshot, recordSuccess: recordBusyReadSuccess, recordFailure: recordBusyReadFailure },
      observe: createBusyCalendarObserver({ settingsUrl: () => 'https://treg.test.local/settings' }),
    }),
  });
}

async function clean(): Promise<void> {
  const supabase = db();
  const { data } = await supabase.from('recruiters').select('id').like('email', '%.s27@test.local');
  for (const { id } of (data ?? []) as { id: string }[]) {
    const { data: resources } = await supabase.from('sched_resources').select('id').eq('external_ref', id);
    const resourceIds = (resources ?? []).map((r) => r.id as string);
    if (resourceIds.length > 0) {
      await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
      await supabase.from('sched_resources').delete().in('id', resourceIds);
    }
    await supabase.from('journal').delete().filter('payload->>recruiterId', 'eq', id).like('action', 'busy_calendar_%');
    await supabase.from('imap_outreach_claims').delete().eq('mailbox_id', 'busy_calendar_blocked').like('uid', `${id}|%`);
    await supabase.from('recruiters').delete().eq('id', id);
  }
}

const previousCron = process.env.CRON_SECRET;

beforeAll(async () => {
  process.env.BUSY_CALENDAR_ENABLED = '1';
  process.env.CRON_SECRET = CRON;
  useConnector();
  registerEventConsumer(async () => {});
  await clean();

  const probe = await db().from('recruiter_busy_snapshots').select('refresh_claimed_at').limit(1);
  if (probe.error) {
    throw new Error(`migrations des lots B/C non appliquées en DEV : ${probe.error.message}`);
  }

  expect(
    (
      await db()
        .from('recruiters')
        .insert({ id: RECRUITER_ID, display_name: 'Camille Test', email: RECRUITER_EMAIL, role: 'member', is_active: true })
    ).error,
  ).toBeNull();
  await patchRecruiter(RECRUITER_ID, { busyIcsUrl: CALENDAR_URL });
  await createResource({
    externalRef: RECRUITER_ID,
    displayName: 'Camille Test',
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 30,
    notifyEmail: RECRUITER_EMAIL,
  });
  await setWeeklyRules(
    RECRUITER_ID,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 18 * 60 })),
  );
});

beforeEach(() => {
  useConnector();
});

afterAll(async () => {
  await clean();
  delete process.env.BUSY_CALENDAR_ENABLED;
  if (previousCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCron;
  registerEventConsumer(null);
  resetSchedulingConfig();
});

// ─── Scénario (séquentiel) ──────────────────────────────────────────────

describe('S27 — la relève fait avancer l’état sans aucune visite', () => {
  it('S27.1 — la relève lit l’agenda et écrit sa copie', async () => {
    agenda = 'live';
    fetches = 0;
    const body = await runCron();
    expect(body).toMatchObject({ ok: true, calendars: { enabled: true } });
    expect((body.calendars as { ok: number }).ok).toBeGreaterThanOrEqual(1);
    expect(fetches).toBe(1);
    const copy = await getBusySnapshot(RECRUITER_ID);
    expect(copy?.failingSince).toBeNull();
    expect(copy?.intervals.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${SECRET}|${RECRUITER_ID}|outlook`));
  });

  it('S27.2 — dépublié depuis peu : TOLÉRÉ, sans email ni signal', async () => {
    agenda = 'unpublished';
    await ageCopy(10 * 60_000);
    resetSentEmails();
    await runCron();
    expect(await journal(BUSY_CALENDAR_STATE_ACTION)).toMatchObject([{ from: 'healthy', to: 'tolerated' }]);
    expect(blockedEmails()).toEqual([]);
    expect(await signal()).toBeUndefined();
  });

  it('S27.3 — au-delà de 2 h ouvrées : SUSPENDU, un email et un signal, même après plusieurs passes', async () => {
    await ageCopy(3 * 86_400_000);
    await runCron();
    await releaseClaim();
    await runCron();

    expect((await journal(BUSY_CALENDAR_STATE_ACTION)).map((p) => p.to)).toEqual(['tolerated', 'blocked']);
    expect(blockedEmails()).toHaveLength(1);
    expect(blockedEmails()[0]!.to).toEqual([RECRUITER_EMAIL]);
    expect((await signal())?.message).toContain('ne sont plus proposés');
  });

  it('S27.4 — redirection hors du fournisseur : journalisée À PART, une fois, avec l’hôte seulement', async () => {
    agenda = 'hijacked';
    await releaseClaim();
    await runCron();
    await releaseClaim();
    await runCron();

    const entries = await journal(BUSY_CALENDAR_REDIRECT_REFUSED_ACTION);
    expect(entries).toEqual([
      { recruiterId: RECRUITER_ID, redirectHost: 'collecte.attaquant.test', security: true },
    ]);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
    expect(await getBusySnapshot(RECRUITER_ID)).toMatchObject({ failureCode: 'redirect_refused' });
    // Toujours la même panne pour le recruteur : pas de nouvel email.
    expect(blockedEmails()).toHaveLength(1);
  });

  it('S27.5 — rétablissement par la relève seule : tout s’éteint', async () => {
    agenda = 'live';
    await releaseClaim();
    await runCron();
    expect(await getBusySnapshot(RECRUITER_ID)).toMatchObject({ failingSince: null, lastState: 'healthy' });
    expect((await journal(BUSY_CALENDAR_STATE_ACTION)).at(-1)).toMatchObject({ from: 'blocked', to: 'healthy' });
    expect(await signal()).toBeUndefined();
  });

  it('S27.6 — deux passes simultanées ne lisent l’agenda qu’une fois', async () => {
    await releaseClaim();
    fetches = 0;
    const [a, b] = await Promise.all([runCron(), runCron()]);
    expect(fetches).toBe(1);
    const skipped = [a, b].map((r) => (r.calendars as { skippedClaimed: number }).skippedClaimed);
    expect(skipped.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(1);
  });

  it('S27.7 — connecteur éteint : la route répond sans rien lire', async () => {
    delete process.env.BUSY_CALENDAR_ENABLED;
    await releaseClaim();
    fetches = 0;
    const body = await runCron();
    expect(body).toMatchObject({ ok: true, calendars: { enabled: false, recruiters: 0 } });
    expect(fetches).toBe(0);
    process.env.BUSY_CALENDAR_ENABLED = '1';
  });
});
