/**
 * Proxy — le FILTRE d'URL (`config.matcher`), pas seulement la fonction.
 *
 * Trou constaté le 14/09/2026 : l'exemption des fichiers statiques
 * (`.png|.jpg|…`) était une expression sur le chemin ENTIER. Une route
 * `/api/…/<id>.png` ne passait donc jamais par le proxy : la garde
 * deny-by-default était contournée, sans session, et la route s'exécutait
 * (mesuré : `/api/reporting/audit/candidates/zzz.png` rendait 404 `not_found`
 * de la route, au lieu de 401).
 *
 * Un test de `proxy()` seul ne voit pas ce défaut — la fonction n'est même pas
 * appelée. On teste donc la correspondance du matcher telle que Next
 * l'applique, PUIS la réponse du proxy.
 */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const getUser = vi.fn(async (request: NextRequest) => ({
  response: NextResponse.next({ request }),
  user: null,
}));
vi.mock('@/lib/auth/middleware-helper', () => ({
  getUserFromMiddleware: (r: NextRequest) => getUser(r),
}));

import { config, proxy } from '@/proxy';

const matches = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://orqa.test${path}` });

/** Toutes les formes qu'une exemption de fichier statique pourrait capturer. */
const API_PATHS_THAT_LOOK_STATIC = [
  '/api/x.png',
  '/api/x.jpg',
  '/api/x.jpeg',
  '/api/x.svg',
  '/api/x.webp',
  '/api/x.woff',
  '/api/x.woff2',
  '/api/reporting/audit/candidates/zzz.png',
  '/api/artifacts/art_1.PNG',
  // Les autres exceptions du filtre, posées sous /api/.
  '/api/_next/static/chunk.js',
  '/api/_next/image',
  '/api/favicon.ico',
  '/api',
];

describe('proxy — le matcher couvre TOUT /api/', () => {
  it.each(API_PATHS_THAT_LOOK_STATIC)('%s : le proxy est invoqué', (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each(API_PATHS_THAT_LOOK_STATIC)('%s sans session ⇒ 401', async (path) => {
    expect(matches(path)).toBe(true);
    const res = await proxy(new NextRequest(new URL(`http://orqa.test${path}`)));
    expect(res.status).toBe(401);
  });
});

describe('proxy — l’exemption statique reste valable HORS de /api/', () => {
  it.each([
    '/logo-orqa.png',
    '/images/hero.webp',
    '/fonts/inter.woff2',
    '/favicon.ico',
    '/_next/static/chunks/app.js',
    '/_next/image',
  ])('%s : pas de proxy (asset)', (path) => {
    expect(matches(path)).toBe(false);
  });

  it.each(['/rh/recrutement', '/validations', '/login', '/r/AbCdEfGh', '/jobs'])(
    '%s : pages toujours filtrées par le proxy',
    (path) => {
      expect(matches(path)).toBe(true);
    },
  );
});
