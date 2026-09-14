/**
 * Proxy — la frontière des surfaces publiques du module Sourcing.
 *
 * La personne approchée n'a pas de compte : `/s/<jeton>` et
 * `/api/sourcing/approach/<jeton>/…` passent SANS session, avec les en-têtes
 * d'une URL porteuse de jeton. Mais `/api/sourcing/approaches/…` — le geste du
 * RECRUTEUR — ne partage que le début du nom : il doit rester gardé. Une
 * correspondance de préfixe trop large ouvrirait la confirmation d'une
 * approche à n'importe qui.
 */
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const getUser = vi.fn(async (request: NextRequest) => ({ response: NextResponse.next({ request }), user: null }));
vi.mock('@/lib/auth/middleware-helper', () => ({ getUserFromMiddleware: (r: NextRequest) => getUser(r) }));

import { proxy } from '@/proxy';

const req = (path: string) => new NextRequest(new URL(`http://orqa.test${path}`), { method: 'POST' });

describe('proxy — surfaces publiques du sourcing', () => {
  it.each(['/s/AbCdEfGhIjKlMnOpQrStUv', '/api/sourcing/approach/AbCdEfGhIjKlMnOpQrStUv/submit', '/api/sourcing/approach/AbCdEfGhIjKlMnOpQrStUv/oppose'])(
    '%s : passe sans session, jamais indexé, jamais en cache, sans Referer',
    async (path) => {
      getUser.mockClear();
      const res = await proxy(req(path));
      expect(res.status).toBe(200);
      expect(getUser).not.toHaveBeenCalled();
      expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    },
  );

  it.each(['/api/sourcing/approaches/11111111-2222-3333-4444-555555555555', '/api/sourcing/approachesX', '/api/sourcing/campaigns', '/api/sourcing/profiles/p1/approaches'])(
    '%s : route du recruteur, 401 sans session',
    async (path) => {
      const res = await proxy(req(path));
      expect(res.status).toBe(401);
    },
  );
});
