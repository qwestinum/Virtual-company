/**
 * S14 — Surfaces publiques de réservation (lot 2).
 *
 * Les handlers de routes RÉELS sont invoqués en-process, contre la base DEV.
 * Ce que ce scénario protège :
 *
 *   1. les trois états d'un lien (ouvert, dégradé, éteint) ;
 *   2. les verdicts de course rendus au navigateur, pas masqués en erreur ;
 *   3. l'opacité : un jeton inconnu et un jeton expiré répondent PAREIL ;
 *   4. la limitation de débit qui MORD réellement ;
 *   5. l'invitation d'agenda — et surtout son IDENTITÉ : déplacer deux fois ne
 *      doit pas créer trois événements dans l'agenda de l'invité, mais en
 *      déplacer un seul, deux fois.
 *
 * Marqueur de purge : `SCHED-TREG2-`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  configureScheduling,
  createBookingLink,
  createRecordingMailer,
  createResource,
  createTarget,
  registerEventConsumer,
  resetSchedulingConfig,
  resolveBookingPage,
  revokeLinkByKey,
  setWeeklyRules,
  type MailMessage,
  type Slot,
} from '@/lib/scheduling';

import { GET as slotsRoute } from '@/app/api/sched/links/[token]/slots/route';
import { POST as bookRoute } from '@/app/api/sched/links/[token]/book/route';
import { GET as manageSlotsRoute } from '@/app/api/sched/bookings/[manageToken]/slots/route';
import { POST as cancelRoute } from '@/app/api/sched/bookings/[manageToken]/cancel/route';
import { POST as rescheduleRoute } from '@/app/api/sched/bookings/[manageToken]/reschedule/route';

import { db } from './helpers/db';

const PREFIX = 'SCHED-TREG2-';
const suffix = Math.random().toString(36).slice(2, 8);
const RESOURCE = `${PREFIX}res-${suffix}`;
const TARGET = `${PREFIX}tgt-${suffix}`;

const mailer = createRecordingMailer();

// ─── Petits utilitaires de requête ──────────────────────────────────────

function req(url: string, init?: RequestInit & { ip?: string }): Request {
  const headers = new Headers(init?.headers);
  headers.set('x-forwarded-for', init?.ip ?? `10.0.0.${Math.floor(Math.random() * 250) + 1}`);
  return new Request(url, { ...init, headers });
}

const WINDOW = () => {
  const from = new Date(Date.now() + 60_000).toISOString();
  const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

async function fetchSlots(token: string, ip?: string): Promise<Slot[]> {
  const response = await slotsRoute(
    req(`https://treg.test/api/sched/links/${token}/slots?${WINDOW()}`, { ip }),
    { params: Promise.resolve({ token }) },
  );
  if (!response.ok) return [];
  return ((await response.json()) as { slots: Slot[] }).slots;
}

async function book(token: string, startAt: string, ip?: string) {
  const response = await bookRoute(
    req(`https://treg.test/api/sched/links/${token}/book`, {
      method: 'POST',
      ip,
      body: JSON.stringify({
        startAt,
        attendee: {
          name: 'Alex Martin',
          email: `alex-${suffix}@test.local`,
          timezone: 'Europe/Paris',
        },
      }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function link(key: string, display?: Record<string, string>) {
  const created = await createBookingLink({
    targetExternalRef: TARGET,
    idempotencyKey: `${key}-${suffix}`,
    context: { probe: key },
    display: display ?? { title: 'Entretien' },
  });
  return created.token;
}

// ─── Lecture d'un .ics reçu ─────────────────────────────────────────────

function icsOf(message: MailMessage): Map<string, string> {
  const attachment = (message.attachments ?? [])[0];
  if (!attachment) throw new Error('message sans invitation d’agenda');
  const raw = Buffer.from(attachment.contentBase64, 'base64')
    .toString('utf8')
    .replace(/\r\n[ \t]/g, '');
  const map = new Map<string, string>();
  for (const line of raw.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).split(';')[0] as string;
    if (!map.has(name)) map.set(name, line.slice(separator + 1));
  }
  return map;
}

const toAttendee = (message: MailMessage): boolean =>
  message.to.some((address) => address.startsWith('alex-'));

async function cleanScheduling(): Promise<void> {
  const supabase = db();
  const { data: targets } = await supabase
    .from('sched_targets')
    .select('id')
    .like('external_ref', `${PREFIX}%`);
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
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: resources } = await supabase
    .from('sched_resources')
    .select('id')
    .like('external_ref', `${PREFIX}%`);
  const resourceIds = (resources ?? []).map((row) => row.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase.from('sched_availability_exceptions').delete().in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
  await supabase.from('sched_rate_limits').delete().like('bucket_key', '%treg2%');
}

beforeAll(async () => {
  configureScheduling({
    supabase: db(),
    mailer,
    publicBaseUrl: 'https://treg.test.local',
    organizationName: 'Cabinet Test',
  });
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
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 9 * 60,
      endMinute: 18 * 60,
    })),
  );
  await createTarget({ externalRef: TARGET, resourceExternalRef: RESOURCE });
});

afterAll(async () => {
  await cleanScheduling();
  registerEventConsumer(null);
  resetSchedulingConfig();
});

describe('S14.1 — états du lien', () => {
  it('ouvre la page et sert des créneaux', async () => {
    const token = await link('open');
    const page = await resolveBookingPage(token);
    expect(page.status).toBe('open');
    expect(await fetchSlots(token)).not.toHaveLength(0);
  });

  it('dégrade proprement quand la cible n’a plus de titulaire', async () => {
    const orphan = `${PREFIX}orphan-${suffix}`;
    await createTarget({ externalRef: orphan });
    const { token } = await createBookingLink({
      targetExternalRef: orphan,
      idempotencyKey: `orphan-${suffix}`,
      display: { title: 'Entretien' },
    });
    expect((await resolveBookingPage(token)).status).toBe('degraded');
    expect(await fetchSlots(token)).toEqual([]);
  });

  it('éteint la page après révocation, sans dire pourquoi', async () => {
    const key = `revoke-${suffix}`;
    const { token } = await createBookingLink({
      targetExternalRef: TARGET,
      idempotencyKey: key,
    });
    await revokeLinkByKey(TARGET, key, 'test');

    const page = await resolveBookingPage(token);
    expect(page.status).toBe('gone');
    expect(await fetchSlots(token)).toEqual([]);

    // Un jeton révoqué et un jeton inconnu répondent PAREIL au navigateur :
    // la route ne doit jamais confirmer qu'un jeton a existé.
    const revoked = await book(token, new Date(Date.now() + 3 * 86_400_000).toISOString());
    const unknown = await book(
      'aaaaaaaaaaaaaaaaaaaaaa',
      new Date(Date.now() + 3 * 86_400_000).toISOString(),
    );
    expect(revoked.response.status).toBe(409);
    expect(unknown.response.status).toBe(409);
    expect(revoked.payload.reason).toBe('link_gone');
    expect(unknown.payload.reason).toBe('link_gone');
  });

  it('pose les en-têtes qui interdisent indexation et cache', async () => {
    const token = await link('headers');
    const response = await slotsRoute(
      req(`https://treg.test/api/sched/links/${token}/slots?${WINDOW()}`),
      { params: Promise.resolve({ token }) },
    );
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('refuse une fenêtre absurde plutôt que de la calculer', async () => {
    const token = await link('window');
    const response = await slotsRoute(
      req(`https://treg.test/api/sched/links/${token}/slots?from=2026-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`),
      { params: Promise.resolve({ token }) },
    );
    expect(response.status).toBe(400);
  });
});

describe('S14.2 — verdicts de course', () => {
  it('rend slot_taken quand deux invités confirment EN MÊME TEMPS', async () => {
    const [a, b] = [await link('race-a'), await link('race-b')];
    const slot = (await fetchSlots(a))[0] as Slot;

    // La concurrence VRAIE est nécessaire : les deux confirmations passent la
    // revalidation avant que l'une d'elles n'insère, et c'est l'index unique
    // qui tranche. C'est le seul chemin qui produit `slot_taken`.
    const [first, second] = await Promise.all([
      book(a, slot.startAt),
      book(b, slot.startAt),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.response.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.response.ok);
    expect(loser?.response.status).toBe(409);
    expect(loser?.payload.reason).toBe('slot_taken');
  });

  it('rend invalid_slot quand le créneau était DÉJÀ pris avant la demande', async () => {
    // Séquentiellement, la revalidation détecte le créneau occupé AVANT toute
    // tentative d'insertion : le motif est donc `invalid_slot`, pas
    // `slot_taken`. Les deux disent la même chose à l'invité — « ce créneau
    // n'est plus libre » — et la page les traite de la même façon.
    const first = await link('taken-a');
    const second = await link('taken-b');
    const slot = (await fetchSlots(first))[1] as Slot;

    expect((await book(first, slot.startAt)).response.ok).toBe(true);
    const late = await book(second, slot.startAt);
    expect(late.response.status).toBe(409);
    expect(late.payload.reason).toBe('invalid_slot');
  });

  // La course re-pointage/confirmation est prouvée au niveau du MODULE par
  // S13.3 : la compensation y est déterministe. Passer par la route ajoute un
  // aller-retour avant la lecture de version, si bien que le re-pointage
  // gagne systématiquement — un test qui ne se déclenche jamais ne prouve
  // rien, et un test qui se déclenche une fois sur dix est pire.
});

describe('S14.3 — limitation de débit', () => {
  it('mord après le budget, et dit quand réessayer', async () => {
    const token = await link('flood');
    const ip = '203.0.113.42';

    let limited: Response | null = null;
    for (let i = 0; i < 15 && !limited; i += 1) {
      const response = await bookRoute(
        req(`https://treg.test/api/sched/links/${token}/book`, {
          method: 'POST',
          ip,
          body: JSON.stringify({ startAt: 'pas-une-date', attendee: {} }),
        }),
        { params: Promise.resolve({ token }) },
      );
      if (response.status === 429) limited = response;
    }

    expect(limited, 'la limitation de débit n’a jamais mordu').not.toBeNull();
    expect(Number(limited?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

describe('S14.4 — invitation d’agenda', () => {
  it('joint une invitation valide à la confirmation, des deux côtés', async () => {
    mailer.sent.length = 0;
    const token = await link('ics');
    const slot = (await fetchSlots(token)).at(-1) as Slot;
    const result = await book(token, slot.startAt);
    expect(result.response.ok).toBe(true);

    expect(mailer.sent).toHaveLength(2);
    const invite = mailer.sent.find(toAttendee) as MailMessage;
    const attachment = (invite.attachments ?? [])[0];
    expect(attachment?.filename).toBe('rendez-vous.ics');
    // Le paramètre `method` décide si les clients affichent une invitation.
    expect(attachment?.contentType).toContain('method=REQUEST');

    const ics = icsOf(invite);
    expect(ics.get('METHOD')).toBe('REQUEST');
    expect(ics.get('SEQUENCE')).toBe('0');
    expect(ics.get('LOCATION')).toBe('https://visio.test.local/salle');
    expect(ics.get('STATUS')).toBe('CONFIRMED');
  });

  it('DÉPLACE le même événement au lieu d’en créer un second', async () => {
    mailer.sent.length = 0;
    const token = await link('series');
    const slots = await fetchSlots(token);
    const first = await book(token, (slots[5] as Slot).startAt);
    expect(first.response.ok).toBe(true);

    const manageUrl = String(first.payload.manageUrl);
    const manageToken = manageUrl.split('/').pop() as string;
    const uidAtBooking = icsOf(mailer.sent.find(toAttendee) as MailMessage).get('UID');

    // Deux déplacements successifs.
    const uids: (string | undefined)[] = [];
    const sequences: (string | undefined)[] = [];
    for (const index of [8, 11]) {
      const available = ((await manageSlots(manageToken)) as Slot[])[index] as Slot;
      mailer.sent.length = 0;
      const response = await rescheduleRoute(
        req(`https://treg.test/api/sched/bookings/${manageToken}/reschedule`, {
          method: 'POST',
          body: JSON.stringify({ startAt: available.startAt }),
        }),
        { params: Promise.resolve({ manageToken }) },
      );
      expect(response.ok).toBe(true);
      const ics = icsOf(mailer.sent.find(toAttendee) as MailMessage);
      uids.push(ics.get('UID'));
      sequences.push(ics.get('SEQUENCE'));
    }

    // MÊME identité d'un bout à l'autre : l'agenda déplace, il ne duplique pas.
    expect(uids[0]).toBe(uidAtBooking);
    expect(uids[1]).toBe(uidAtBooking);
    expect(sequences).toEqual(['1', '2']);

    // Et l'annulation retire CE même événement.
    mailer.sent.length = 0;
    const cancelled = await cancelRoute(
      req(`https://treg.test/api/sched/bookings/${manageToken}/cancel`, {
        method: 'POST',
        body: '{}',
      }),
      { params: Promise.resolve({ manageToken }) },
    );
    expect(cancelled.ok).toBe(true);
    const goodbye = icsOf(mailer.sent.find(toAttendee) as MailMessage);
    expect(goodbye.get('UID')).toBe(uidAtBooking);
    expect(goodbye.get('METHOD')).toBe('CANCEL');
    expect(goodbye.get('STATUS')).toBe('CANCELLED');
    expect(goodbye.get('SEQUENCE')).toBe('3');
  });
});

async function manageSlots(manageToken: string): Promise<Slot[]> {
  const response = await manageSlotsRoute(
    req(`https://treg.test/api/sched/bookings/${manageToken}/slots?${WINDOW()}`),
    { params: Promise.resolve({ manageToken }) },
  );
  if (!response.ok) return [];
  return ((await response.json()) as { slots: Slot[] }).slots;
}
