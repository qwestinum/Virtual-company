/**
 * Proxy Next.js (ex-middleware) — gate d'authentification.
 *
 * Convention Next 16 : le fichier doit s'appeler `proxy.ts` (et non
 * plus `middleware.ts` — déprécié) et exporter une fonction nommée
 * `proxy` ou un `default`.
 *
 * Protège `/app/*`, `/rh/*`, `/settings/*`. Si pas de session valide,
 * redirige vers `/login?next=<path-tenté>` pour reprendre la
 * navigation après auth. Rafraîchit aussi le refresh-token Supabase
 * via `getUserFromMiddleware` (cookies posés sur la response).
 *
 * Le matcher exclut explicitement les assets et les routes publiques
 * (`/`, `/login`, `/auth/callback`, `/api/*`) pour éviter une
 * recursion ou un blocage en cas de session invalide.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getUserFromMiddleware } from '@/lib/auth/middleware-helper';

const PROTECTED_PREFIXES = ['/app', '/rh', '/settings', '/validations'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user } = await getUserFromMiddleware(request);

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
    // Exclut : _next assets, favicon, fichiers static, API routes
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?)$).*)',
  ],
};
