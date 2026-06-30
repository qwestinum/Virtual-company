/**
 * Proxy Next.js (ex-middleware) — gate d'authentification.
 *
 * Convention Next 16 : le fichier doit s'appeler `proxy.ts` (et non
 * plus `middleware.ts` — déprécié) et exporter une fonction nommée
 * `proxy` ou un `default`.
 *
 * Deux régimes :
 *  - PAGES protégées (`/app`, `/rh`, `/settings`, `/validations`, `/admin`) :
 *    pas de session valide → redirect vers `/login?next=<path>`. NB : `/admin`
 *    n'a PAS encore de contrôle de RÔLE (session seule) — cf. docs/BACKLOG.md.
 *  - ROUTES `/api` : DENY-BY-DEFAULT. Toute route `/api` exige une session
 *    valide → sinon 401 JSON (jamais de redirect : un fetch d'API ne doit pas
 *    recevoir du HTML). SEULES exceptions : les routes à auth PROPRE (webhook
 *    Cal.com signé HMAC, cron authentifié par CRON_SECRET) qui se valident
 *    elles-mêmes. Conséquence voulue : toute NOUVELLE route `/api` est protégée
 *    par défaut, sans rien à ajouter.
 *
 * Rafraîchit aussi le refresh-token Supabase via `getUserFromMiddleware`
 * (cookies posés sur la response).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getUserFromMiddleware } from '@/lib/auth/middleware-helper';

const PROTECTED_PREFIXES = ['/app', '/rh', '/settings', '/validations', '/admin'];

/**
 * Routes `/api` à auth PROPRE (pas de session) — à NE PAS gater, sinon on
 * casse le webhook et le cron. Toute autre route `/api` est gardée par défaut.
 */
const API_SELF_AUTHENTICATED = ['/api/webhooks/calcom', '/api/cron/imap-poll'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isApiSelfAuthenticated(pathname: string): boolean {
  return API_SELF_AUTHENTICATED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user } = await getUserFromMiddleware(request);

  // Régime API : deny-by-default, 401 (pas de redirect).
  if (pathname.startsWith('/api/')) {
    if (isApiSelfAuthenticated(pathname)) return response;
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return response;
  }

  // Régime pages : redirect vers /login.
  if (isProtected(pathname) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Exclut : _next assets, favicon, fichiers static. `/api` est désormais
    // INCLUS (gate deny-by-default dans `proxy`).
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?)$).*)',
  ],
};
