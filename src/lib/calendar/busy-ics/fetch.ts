/**
 * Lecture HTTP d'un agenda publié. Server-only.
 *
 * L'URL est un SECRET (elle donne accès aux disponibilités d'une personne) et
 * elle est fournie par un utilisateur puis lue par le serveur. D'où :
 *
 *   - AUCUN message d'erreur ne sort d'ici. Toute exception est ramenée à un
 *     code : les erreurs de `fetch` de Node embarquent l'URL complète
 *     (« Failed to parse URL from https://… ») — c'est la fuite la plus probable
 *     du secret, et elle se produirait dans un journal ou une réponse d'API ;
 *   - https seulement, sans identifiants ni port exotique, et un hôte reconnu
 *     d'un fournisseur ACCEPTÉ (pas de sonde du réseau interne) ;
 *   - redirections suivies À LA MAIN, uniquement vers les domaines de CE
 *     fournisseur. Un `Location:` ailleurs n'est PAS suivi : `redirect_refused`,
 *     un cas à part (anomalie), distinct d'une panne ordinaire ;
 *   - délai et taille bornés, lecture en flux.
 *
 * Spec : docs/specs/agenda-externe.md §2.4, §11.
 */
import { providerForHost, isProviderDomain, CALENDAR_PROVIDERS, type CalendarProviderId } from './providers';
import { checkCalendarResponse, type CalendarResponseFailure } from './response';

export type CalendarFetchFailure =
  | CalendarResponseFailure
  | 'invalid_url'
  | 'host_not_allowed'
  | 'provider_not_accepted'
  | 'redirect_refused'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'network';

export type CalendarFetchResult =
  | { ok: true; body: string; provider: CalendarProviderId; durationMs: number }
  | { ok: false; code: CalendarFetchFailure; durationMs: number };

export type CalendarFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Horloge monotone injectable (tests). */
  clock?: () => number;
};

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Valide une URL collée et en rend la forme lisible (`webcal://` réécrit en
 * `https://`), ou le motif du refus. Utilisée aussi à la saisie.
 */
export function normalizeCalendarUrl(
  raw: string,
): { ok: true; url: URL; provider: CalendarProviderId } | { ok: false; code: 'invalid_url' | 'host_not_allowed' | 'provider_not_accepted' } {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: 'invalid_url' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { ok: false, code: 'invalid_url' };
  }
  const provider = providerForHost(url.hostname);
  if (!provider) return { ok: false, code: 'host_not_allowed' };
  if (!CALENDAR_PROVIDERS[provider].accepted) return { ok: false, code: 'provider_not_accepted' };
  return { ok: true, url, provider };
}

export async function fetchBusyCalendar(
  rawUrl: string,
  options: CalendarFetchOptions = {},
): Promise<CalendarFetchResult> {
  const clock = options.clock ?? (() => performance.now());
  const startedAt = clock();
  const elapsed = (): number => Math.round(clock() - startedAt);
  const fail = (code: CalendarFetchFailure): CalendarFetchResult => ({ ok: false, code, durationMs: elapsed() });

  const normalized = normalizeCalendarUrl(rawUrl);
  if (!normalized.ok) return fail(normalized.code);
  const { provider } = normalized;

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let url = normalized.url;
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/calendar' },
        cache: 'no-store',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) return fail('http_status');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return fail('redirect_refused');
        }
        if (next.protocol !== 'https:' || next.username || next.password || next.port) {
          return fail('redirect_refused');
        }
        if (!isProviderDomain(provider, next.hostname)) return fail('redirect_refused');
        if (hop + 1 > maxRedirects) return fail('too_many_redirects');
        url = next;
        continue;
      }

      const body = await readCapped(response, maxBytes);
      if (body === null) return fail('too_large');
      const verdict = checkCalendarResponse({
        status: response.status,
        contentType: response.headers.get('content-type'),
        body,
      });
      if (!verdict.ok) return fail(verdict.code);
      return { ok: true, body, provider, durationMs: elapsed() };
    }
  } catch {
    // Jamais le message : il porte l'URL.
    return fail(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Corps en texte, ou `null` au-delà de `maxBytes` (lecture interrompue). */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
