/**
 * Proxy Next.js (ex-middleware) — gate d'authentification.
 *
 * Convention Next 16 : le fichier doit s'appeler `proxy.ts` (et non
 * plus `middleware.ts` — déprécié) et exporter une fonction nommée
 * `proxy` ou un `default`.
 *
 * Deux régimes :
 *  - PAGES protégées (`/app`, `/rh`, `/settings`, `/validations`, `/admin`) :
 *    pas de session valide → redirect vers `/login?next=<path>`. `/admin`
 *    exige EN PLUS le rôle admin (lookup `recruiters.role`, fail-closed —
 *    limité au préfixe /admin pour ne pas payer un lookup DB par requête).
 *  - ROUTES `/api` : DENY-BY-DEFAULT. Toute route `/api` exige une session
 *    valide → sinon 401 JSON (jamais de redirect : un fetch d'API ne doit pas
 *    recevoir du HTML). SEULES exceptions : les routes à auth PROPRE (webhook
 *    Cal.com signé HMAC, cron authentifié par CRON_SECRET, réservation
 *    authentifiée par jeton d'URL) qui se valident elles-mêmes. Conséquence
 *    voulue : toute NOUVELLE route `/api` est protégée par défaut, sans rien
 *    à ajouter.
 *  - SURFACES PUBLIQUES de réservation (`/r/`, `/b/`, `/api/sched/`) :
 *    court-circuit AVANT tout travail d'authentification. Les pages, elles,
 *    n'ont besoin d'aucune exemption — le régime « pages » est une LISTE
 *    BLANCHE, donc tout ce qui n'y figure pas est déjà public ; les inscrire
 *    ici laisserait croire à une garde qui n'existe pas.
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
const API_SELF_AUTHENTICATED = [
  '/api/webhooks/calcom',
  '/api/cron/imap-poll',
  // Réservation : l'appelant est un invité sans compte, son authentification
  // est le jeton nominatif de l'URL, vérifié par le module.
  '/api/sched',
  // Jobboard de démonstration : le candidat n'a pas de compte. La route se
  // garde elle-même par `DEMO_JOBBOARD_ENABLED` (fail-closed, 404 si absent)
  // — sans cette entrée, le régime deny-by-default rendrait 401 et le
  // formulaire public serait inutilisable.
  '/api/jobs/apply',
];

/**
 * Surfaces ouvertes aux invités. Elles ne nécessitent AUCUNE session, et
 * chercher à en rafraîchir une coûterait un aller-retour d'authentification
 * sur le chemin critique d'une page ouverte depuis un email, pour un résultat
 * toujours nul.
 */
const PUBLIC_BOOKING_PREFIXES = ['/r/', '/b/', '/api/sched/'];

/**
 * Pages du jobboard de démonstration. Elles n'ont besoin d'AUCUNE exemption
 * d'authentification — le régime « pages » est une liste blanche, donc tout ce
 * qui n'y figure pas est déjà public. Elles sont listées ici pour une seule
 * raison : leur poser `noindex` et `no-store`. Une plateforme d'emploi fictive
 * hébergée sur une URL publique n'a rien à faire dans un moteur de recherche,
 * et une annonce dépubliée ne doit pas survivre dans un cache intermédiaire.
 */
const DEMO_JOBBOARD_PREFIX = '/jobs';

/** Réponses tokenisées : jamais indexées, jamais mises en cache par un tiers. */
function publicBookingResponse(): NextResponse {
  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  // Le jeton est dans l'URL : sans cela il partirait dans le `Referer` de la
  // première ressource externe ouverte depuis la page.
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function isPublicBooking(pathname: string): boolean {
  return PUBLIC_BOOKING_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** `/jobs` et `/jobs/…` — mais pas `/jobsomething`. */
function isDemoJobboardPage(pathname: string): boolean {
  return (
    pathname === DEMO_JOBBOARD_PREFIX ||
    pathname.startsWith(`${DEMO_JOBBOARD_PREFIX}/`)
  );
}

/** Pages publiques non indexables, sans jeton dans l'URL. */
function noIndexResponse(): NextResponse {
  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return response;
}

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

  // Surfaces de réservation : on sort AVANT de toucher à l'authentification.
  if (isPublicBooking(pathname)) return publicBookingResponse();

  // Jobboard de démonstration : pages ouvertes, jamais indexées. Comme pour la
  // réservation, on sort avant l'authentification — rafraîchir une session
  // inexistante coûterait un aller-retour sur le chemin critique d'une page
  // ouverte depuis un téléphone en rendez-vous.
  if (isDemoJobboardPage(pathname)) return noIndexResponse();

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

  // Rôle ADMIN requis sur /admin (session déjà validée ci-dessus). Lookup
  // `recruiters.role` fail-closed : table absente / ligne absente /
  // désactivé / doute ⇒ member ⇒ redirect. L'URL cachée n'est plus une
  // protection.
  if (user && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const { getRecruiterRole } = await import('@/lib/db/repos/recruiters');
    const role = await getRecruiterRole(user.id);
    if (role !== 'admin') {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = '/app';
      homeUrl.search = '';
      return NextResponse.redirect(homeUrl);
    }
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
