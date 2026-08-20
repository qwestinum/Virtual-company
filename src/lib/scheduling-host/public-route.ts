/**
 * Socle commun des routes publiques de réservation.
 *
 * Ces routes sont les seules de l'application qui répondent SANS session : leur
 * authentification est le jeton d'URL. Tout ce qui doit être vrai pour chacune
 * d'elles est donc centralisé ici plutôt que répété — une garde qu'on doit
 * penser à recopier finit par manquer quelque part.
 *
 * Ce socle applique, dans l'ordre :
 *   1. le branchement du module ;
 *   2. la limitation de débit, par adresse ET par jeton ;
 *   3. des en-têtes qui interdisent l'indexation et toute mise en cache — une
 *      réponse tokenisée gardée par un intermédiaire serait servie à quelqu'un
 *      d'autre.
 */
import { NextResponse } from 'next/server';

import { consumeRateLimit, type RateLimitedAction } from '@/lib/scheduling';

import { ensureSchedulingConfigured } from './configure';

/** En-têtes de toute réponse tokenisée. */
export const PUBLIC_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  // Le jeton est dans l'URL : sans cet en-tête, il partirait dans le `Referer`
  // de la première ressource externe cliquée depuis la page.
  'Referrer-Policy': 'no-referrer',
};

/**
 * Adresse de l'appelant. Derrière un proxy, `x-forwarded-for` est une liste :
 * la PREMIÈRE entrée est le client d'origine. `null` si rien d'exploitable —
 * la limitation par jeton s'applique quand même.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || null;
}

export function publicJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS });
}

/**
 * Enveloppe une route publique. Rend une réponse 429 si le débit est dépassé,
 * sinon exécute le traitement et garantit les en-têtes.
 */
export async function withPublicGuards(
  request: Request,
  params: { action: RateLimitedAction; token: string },
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  await ensureSchedulingConfigured();

  const verdict = await consumeRateLimit({
    action: params.action,
    token: params.token,
    ip: clientIp(request),
    now: new Date(),
  });
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { ...PUBLIC_HEADERS, 'Retry-After': String(verdict.retryAfterSeconds) },
      },
    );
  }

  const response = await handler();
  for (const [key, value] of Object.entries(PUBLIC_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** Fenêtre demandée, bornée : une plage absurde ne doit pas devenir un calcul absurde. */
export function readWindow(request: Request): { from: string; to: string } | null {
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return null;

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;
  // 60 jours : au-delà, c'est l'horizon de la ressource qui tranche de toute façon.
  if (toMs - fromMs > 60 * 86_400_000) return null;

  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}
