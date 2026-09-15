/**
 * S28 — Agenda externe : saisie du lien par le recruteur, activation cabinet (lot D).
 *
 * Routes RÉELLES `/api/recruiters/[id]/busy-calendar` (GET, PUT, DELETE) et
 * `/busy-calendar/test` (POST), base DEV. Seules la session et la réponse
 * d'Outlook sont simulées — la lecture HTTP, la règle d'acceptation, le
 * parseur, le chiffrement, la copie en base et le journal sont réels.
 *
 * Ce que ce scénario protège :
 *   1. le connecteur éteint au CABINET ne propose rien de nouveau (404) ;
 *   2. soi-même ou administrateur, personne d'autre ;
 *   3. TESTER ne stocke rien ; un lien illisible ne s'ENREGISTRE pas ;
 *   4. enregistrer chiffre le lien, amorce la copie, journalise sans l'URL ;
 *   5. l'URL ne ressort JAMAIS : ni réponse, ni base en clair, ni journal ;
 *   6. le débit est borné par recruteur ;
 *   7. cabinet éteint avec un lien enregistré : l'écran le dit IGNORÉ, et on
 *      peut encore le retirer ;
 *   8. déploiement sans connecteur : la surface n'existe pas (404).
 *
 * ⚠️ Migrations des lots A à D à appliquer en DEV.
 *
 * Marqueur de purge : recruteurs `*.s28@test.local`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

vi.mock('@/lib/auth/supabase-server', () => ({
  getAuthServerClient: async () =>
    authState.user === null ? null : { auth: { getUser: async () => ({ data: { user: authState.user } }) } },
}));

vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/require-api-user')>('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => authState.user };
});

import { _resetRoleCacheForTests } from '@/lib/auth/require-api-user';
import { GET, PUT, DELETE } from '@/app/api/recruiters/[id]/busy-calendar/route';
import { POST as testRoute } from '@/app/api/recruiters/[id]/busy-calendar/test/route';
import { getBusySnapshot } from '@/lib/db/repos/busy-snapshots';

import { setBusyCalendarCabinet } from './helpers/busy-calendar';
import { db } from './helpers/db';

const suffix = Math.random().toString(36).slice(2, 8);
const people = {
  camille: { id: randomUUID(), email: `camille-${suffix}.s28@test.local`, role: 'member' },
  paul: { id: randomUUID(), email: `paul-${suffix}.s28@test.local`, role: 'member' },
  admin: { id: randomUUID(), email: `admin-${suffix}.s28@test.local`, role: 'admin' },
  flood: { id: randomUUID(), email: `flood-${suffix}.s28@test.local`, role: 'member' },
} as const;

const SECRET = 'SECRET-TOKEN-S28';
const LIVE = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${SECRET}/cid-0/calendar.ics`;
const DEAD = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/DEAD-${SECRET}/cid-0/calendar.ics`;
const GOOGLE = `https://calendar.google.com/calendar/ical/x/private-${SECRET}/basic.ics`;

// ─── Outlook simulé (forme mesurée le 15/09) ────────────────────────────

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  ...[2, 5].flatMap((offset) => [
    'BEGIN:VEVENT',
    `UID:s28-${offset}`,
    'SUMMARY;LANGUAGE=fr-FR:Occupé(e)',
    `DTSTART:${day(offset)}T080000Z`,
    `DTEND:${day(offset)}T090000Z`,
    'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
    'END:VEVENT',
  ]),
  'END:VCALENDAR',
  '',
].join('\r\n');

const realFetch = globalThis.fetch;
function outlook(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith('https://outlook.live.com/')) return realFetch(input, init);
  if (url.includes('errorFE.aspx')) {
    return Promise.resolve(
      new Response('<!DOCTYPE html><html>GetAnonymousCalendarSessionData failed</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
  }
  if (url.includes('DEAD-')) {
    return Promise.resolve(new Response(null, { status: 302, headers: { location: '/owa/auth/errorFE.aspx?httpCode=404' } }));
  }
  return Promise.resolve(new Response(FEED, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } }));
}

// ─── Appels ─────────────────────────────────────────────────────────────

type Result = { status: number; body: Record<string, unknown>; raw: string };

async function call(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  init: { method: string; body?: unknown },
): Promise<Result> {
  const request = new Request('https://treg.test/api/recruiters/x/busy-calendar', {
    method: init.method,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
  });
  const response = await handler(request, { params: Promise.resolve({ id }) });
  const raw = await response.text();
  return { status: response.status, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, raw };
}

const as = (who: keyof typeof people) => {
  authState.user = { id: people[who].id, email: people[who].email };
};

async function storedUrl(id: string): Promise<string | null> {
  const { data } = await db().from('recruiters').select('busy_ics_url').eq('id', id).single();
  return (data as { busy_ics_url: string | null }).busy_ics_url;
}

async function journal(id: string) {
  const { data } = await db()
    .from('journal')
    .select('action, actor, payload')
    .like('action', 'busy_calendar_url_%')
    .filter('payload->>recruiterId', 'eq', id);
  return (data ?? []) as Record<string, unknown>[];
}

async function clean(): Promise<void> {
  const supabase = db();
  const { data } = await supabase.from('recruiters').select('id').like('email', '%.s28@test.local');
  for (const { id } of (data ?? []) as { id: string }[]) {
    await supabase.from('journal').delete().filter('payload->>recruiterId', 'eq', id).like('action', 'busy_calendar_%');
    await supabase.from('sched_rate_limits').delete().like('bucket_key', `%${id}%`);
    await supabase.from('recruiters').delete().eq('id', id);
  }
}

let restoreCabinet: () => Promise<void> = async () => {};

beforeAll(async () => {
  process.env.BUSY_CALENDAR_ENABLED = '1';
  await clean();
  const inserted = await db()
    .from('recruiters')
    .insert(
      Object.values(people).map((p) => ({ id: p.id, display_name: p.email, email: p.email, role: p.role, is_active: true })),
    );
  expect(inserted.error).toBeNull();
  restoreCabinet = await setBusyCalendarCabinet(false);
  vi.spyOn(globalThis, 'fetch').mockImplementation(outlook);
});

beforeEach(() => {
  _resetRoleCacheForTests();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await restoreCabinet();
  await clean();
  delete process.env.BUSY_CALENDAR_ENABLED;
  authState.user = null;
});

// ─── Scénario (séquentiel) ──────────────────────────────────────────────

describe('S28 — saisie du lien d’agenda', () => {
  it('S28.1 — cabinet éteint : l’écran répond, rien de nouveau ne se propose', async () => {
    as('camille');
    const status = await call(GET, people.camille.id, { method: 'GET' });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ available: false, configured: false, state: 'unconfigured' });
    expect((await call(testRoute, people.camille.id, { method: 'POST', body: { url: LIVE } })).status).toBe(404);
    expect((await call(PUT, people.camille.id, { method: 'PUT', body: { url: LIVE } })).status).toBe(404);
    await setBusyCalendarCabinet(true);
  });

  it('S28.2 — soi-même ou administrateur, personne d’autre', async () => {
    authState.user = null;
    expect((await call(GET, people.camille.id, { method: 'GET' })).status).toBe(401);
    as('paul');
    expect((await call(GET, people.camille.id, { method: 'GET' })).status).toBe(403);
    expect((await call(PUT, people.camille.id, { method: 'PUT', body: { url: LIVE } })).status).toBe(403);
    as('admin');
    expect((await call(GET, people.camille.id, { method: 'GET' })).status).toBe(200);
  });

  it('S28.3 — TESTER lit l’agenda, dit ce qu’il y trouve, et ne stocke rien', async () => {
    as('camille');
    const result = await call(testRoute, people.camille.id, { method: 'POST', body: { url: LIVE } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      message: 'Agenda lu : 2 plages occupées sur les 30 prochains jours.',
      warnings: [],
    });
    expect(result.raw).not.toContain(SECRET);
    expect(await storedUrl(people.camille.id)).toBeNull();
    expect(await getBusySnapshot(people.camille.id)).toBeNull();
  });

  it('S28.4 — un lien illisible est expliqué, et ne s’enregistre pas', async () => {
    as('camille');
    const dead = await call(testRoute, people.camille.id, { method: 'POST', body: { url: DEAD } });
    expect(dead.status).toBe(422);
    expect(String(dead.body.message)).toContain('lien ICS');
    const google = await call(testRoute, people.camille.id, { method: 'POST', body: { url: GOOGLE } });
    expect(String(google.body.message)).toContain('Google');

    const refused = await call(PUT, people.camille.id, { method: 'PUT', body: { url: DEAD } });
    expect(refused.status).toBe(422);
    expect(refused.raw).not.toContain(SECRET);
    expect(await storedUrl(people.camille.id)).toBeNull();
  });

  it('S28.5 — ENREGISTRER chiffre, amorce la copie, journalise — sans jamais rendre l’URL', async () => {
    as('camille');
    const saved = await call(PUT, people.camille.id, { method: 'PUT', body: { url: LIVE } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      ok: true,
      status: { available: true, configured: true, providerLabel: 'Outlook', state: 'healthy', upcomingCount: 2 },
    });
    expect(saved.raw).not.toContain(SECRET);

    const blob = await storedUrl(people.camille.id);
    expect(blob).not.toBeNull();
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain('outlook');

    expect(await getBusySnapshot(people.camille.id)).toMatchObject({ failingSince: null, occurrenceCount: 2 });

    const entries = await journal(people.camille.id);
    expect(entries).toMatchObject([{ action: 'busy_calendar_url_set', payload: { provider: 'Outlook' } }]);
    expect(JSON.stringify(entries)).not.toContain(SECRET);

    const status = await call(GET, people.camille.id, { method: 'GET' });
    expect(status.body).toMatchObject({ configured: true, state: 'healthy' });
    expect(status.raw).not.toContain(SECRET);
  });

  it('S28.6 — un administrateur peut poser le lien d’un autre (et ne le relit jamais)', async () => {
    as('admin');
    const saved = await call(PUT, people.paul.id, { method: 'PUT', body: { url: LIVE } });
    expect(saved.status).toBe(200);
    expect(saved.raw).not.toContain(SECRET);
    expect((await journal(people.paul.id))[0]).toMatchObject({ payload: { actorUserId: people.admin.id } });
  });

  it('S28.7 — le débit est borné par recruteur', async () => {
    as('flood');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await call(testRoute, people.flood.id, { method: 'POST', body: { url: LIVE } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('S28.8 — cabinet éteint, lien enregistré : dit IGNORÉ, et reste retirable', async () => {
    await setBusyCalendarCabinet(false);
    as('camille');
    expect((await call(GET, people.camille.id, { method: 'GET' })).body).toMatchObject({
      available: false,
      configured: true,
    });

    const cleared = await call(DELETE, people.camille.id, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ configured: false, state: 'unconfigured' });
    expect(await storedUrl(people.camille.id)).toBeNull();
    expect(await getBusySnapshot(people.camille.id)).toBeNull();
    expect((await journal(people.camille.id)).map((e) => e.action)).toContain('busy_calendar_url_cleared');
  });

  it('S28.9 — déploiement sans connecteur : la surface n’existe pas', async () => {
    delete process.env.BUSY_CALENDAR_ENABLED;
    as('camille');
    expect((await call(GET, people.camille.id, { method: 'GET' })).status).toBe(404);
    expect((await call(DELETE, people.camille.id, { method: 'DELETE' })).status).toBe(404);
    process.env.BUSY_CALENDAR_ENABLED = '1';
  });
});
