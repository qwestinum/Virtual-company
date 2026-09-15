/**
 * Lecture HTTP d'un agenda publié — règle d'acceptation, redirections,
 * bornes, et silence sur l'URL. Aucun réseau : `fetch` est injecté.
 *
 * Les réponses Outlook reproduisent ce qui a été MESURÉ le 15/09/2026 :
 * URL vivante = 200 text/calendar ; URL dépubliée = 302 vers une page HTML
 * d'erreur (« GetAnonymousCalendarSessionData failed »).
 */
import { describe, expect, it } from 'vitest';

import { fetchBusyCalendar, normalizeCalendarUrl } from '../fetch';
import { checkCalendarResponse } from '../response';

const SECRET = 'f00dfeed-SECRET-TOKEN-0000';
const LIVE_URL = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${SECRET}/cid-0/calendar.ics`;
const CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const ERROR_PAGE = '<!DOCTYPE html><html><body>GetAnonymousCalendarSessionData failed</body></html>';

type Step = { status: number; headers?: Record<string, string>; body?: string };

/** `fetch` scripté : une réponse par appel, et le relevé des URL demandées. */
function scripted(...steps: Step[]) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`appel inattendu vers ${String(input)}`);
    return new Response(step.body ?? null, { status: step.status, headers: step.headers });
  }) as typeof fetch;
  return { impl, calls };
}

const ok = (body = CALENDAR, contentType = 'text/calendar; charset=utf-8'): Step => ({
  status: 200,
  headers: { 'content-type': contentType },
  body,
});

describe('checkCalendarResponse — les quatre conditions', () => {
  const base = { status: 200, contentType: 'text/calendar', body: CALENDAR };

  it('accepte 200 + text/calendar + BEGIN + END, paramètres de type compris', () => {
    expect(checkCalendarResponse(base)).toEqual({ ok: true });
    expect(checkCalendarResponse({ ...base, contentType: 'Text/Calendar; charset=UTF-8' })).toEqual({ ok: true });
  });

  it('refuse un statut autre que 200', () => {
    expect(checkCalendarResponse({ ...base, status: 302 })).toEqual({ ok: false, code: 'http_status' });
    expect(checkCalendarResponse({ ...base, status: 404 })).toEqual({ ok: false, code: 'http_status' });
  });

  it('refuse la page HTML d’erreur d’une URL dépubliée', () => {
    expect(checkCalendarResponse({ status: 200, contentType: 'text/html; charset=utf-8', body: ERROR_PAGE })).toEqual({
      ok: false,
      code: 'not_calendar',
    });
  });

  it('refuse un text/calendar qui ne contient pas de calendrier', () => {
    expect(checkCalendarResponse({ ...base, body: ERROR_PAGE })).toEqual({ ok: false, code: 'not_calendar' });
  });

  it('refuse un téléchargement coupé (pas de END:VCALENDAR)', () => {
    expect(checkCalendarResponse({ ...base, body: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:2026' })).toEqual({
      ok: false,
      code: 'truncated',
    });
  });
});

describe('normalizeCalendarUrl', () => {
  it('réécrit webcal:// en https://', () => {
    const r = normalizeCalendarUrl(LIVE_URL.replace('https://', 'webcal://'));
    expect(r.ok && r.url.protocol).toBe('https:');
  });

  it('refuse http, identifiants, port et hôtes inconnus', () => {
    expect(normalizeCalendarUrl(LIVE_URL.replace('https://', 'http://'))).toMatchObject({ code: 'invalid_url' });
    expect(normalizeCalendarUrl('https://u:p@outlook.live.com/x.ics')).toMatchObject({ code: 'invalid_url' });
    expect(normalizeCalendarUrl('https://outlook.live.com:8443/x.ics')).toMatchObject({ code: 'invalid_url' });
    expect(normalizeCalendarUrl('https://169.254.169.254/latest/meta-data')).toMatchObject({ code: 'host_not_allowed' });
    expect(normalizeCalendarUrl('https://outlook.live.com.evil.test/x.ics')).toMatchObject({ code: 'host_not_allowed' });
    expect(normalizeCalendarUrl('pas une url')).toMatchObject({ code: 'invalid_url' });
  });

  it('refuse Google tant que sa dépublication n’est pas mesurée', () => {
    expect(normalizeCalendarUrl('https://calendar.google.com/calendar/ical/x/private-y/basic.ics')).toMatchObject({
      code: 'provider_not_accepted',
    });
  });
});

describe('fetchBusyCalendar', () => {
  it('lit une URL vivante', async () => {
    const { impl, calls } = scripted(ok());
    const r = await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl });
    expect(r).toMatchObject({ ok: true, body: CALENDAR, provider: 'microsoft' });
    expect(calls).toHaveLength(1);
  });

  it('suit une redirection vers un domaine du fournisseur, et juge la destination', async () => {
    const { impl, calls } = scripted(
      { status: 302, headers: { location: 'https://outlook.live.com/owa/error.aspx' } },
      ok(ERROR_PAGE, 'text/html; charset=utf-8'),
    );
    const r = await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, code: 'not_calendar' });
    expect(calls).toEqual([LIVE_URL, 'https://outlook.live.com/owa/error.aspx']);
  });

  it('suit une redirection relative', async () => {
    const { impl, calls } = scripted({ status: 301, headers: { location: '/owa/calendar/autre.ics' } }, ok());
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl })).toMatchObject({ ok: true });
    expect(calls[1]).toBe('https://outlook.live.com/owa/calendar/autre.ics');
  });

  it('NE SUIT PAS une redirection hors des domaines du fournisseur : cas à part', async () => {
    for (const location of [
      'https://attaquant.test/collecte',
      'https://outlook.live.com.attaquant.test/x',
      'https://calendar.google.com/x.ics',
      'http://outlook.live.com/x.ics',
      'https://10.0.0.1/interne',
    ]) {
      const { impl, calls } = scripted({ status: 302, headers: { location } });
      const r = await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl });
      expect(r).toMatchObject({ ok: false, code: 'redirect_refused' });
      expect(calls).toHaveLength(1);
    }
  });

  it('borne le nombre de redirections', async () => {
    const hop: Step = { status: 302, headers: { location: 'https://outlook.live.com/boucle' } };
    const { impl, calls } = scripted(hop, hop, hop, hop, hop);
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl })).toMatchObject({ code: 'too_many_redirects' });
    expect(calls).toHaveLength(4);
  });

  it('refuse une redirection sans destination', async () => {
    const { impl } = scripted({ status: 302 });
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: impl })).toMatchObject({ code: 'http_status' });
  });

  it('refuse un corps trop volumineux, annoncé ou non', async () => {
    const big = `BEGIN:VCALENDAR\r\n${'X'.repeat(2_000)}\r\nEND:VCALENDAR\r\n`;
    const announced = scripted({ ...ok(big), headers: { 'content-type': 'text/calendar', 'content-length': '999999' } });
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: announced.impl, maxBytes: 1_000 })).toMatchObject({
      code: 'too_large',
    });
    const streamed = scripted(ok(big));
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: streamed.impl, maxBytes: 1_000 })).toMatchObject({
      code: 'too_large',
    });
  });

  it('rend `timeout` quand la source ne répond pas à temps', async () => {
    const hanging = ((_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${LIVE_URL}`)));
      })) as typeof fetch;
    expect(await fetchBusyCalendar(LIVE_URL, { fetchImpl: hanging, timeoutMs: 20 })).toMatchObject({
      ok: false,
      code: 'timeout',
    });
  });

  it('ne laisse JAMAIS l’URL dans ce qu’il rend, même quand l’erreur la contient', async () => {
    const leaky = (async () => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${LIVE_URL}`);
    }) as typeof fetch;
    const r = await fetchBusyCalendar(LIVE_URL, { fetchImpl: leaky });
    expect(r).toMatchObject({ ok: false, code: 'network' });
    expect(JSON.stringify(r)).not.toContain(SECRET);

    const refused = await fetchBusyCalendar(LIVE_URL, {
      fetchImpl: scripted({ status: 302, headers: { location: `https://attaquant.test/${SECRET}` } }).impl,
    });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});
