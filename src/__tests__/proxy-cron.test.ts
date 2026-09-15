/**
 * Proxy — les routes de cron passent sans session (leur garde est le Bearer
 * CRON_SECRET, vérifié par la route), et seulement elles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const getUser = vi.fn(async (request: NextRequest) => ({ response: NextResponse.next({ request }), user: null }));
vi.mock('@/lib/auth/middleware-helper', () => ({ getUserFromMiddleware: (r: NextRequest) => getUser(r) }));

import { proxy } from '@/proxy';

const req = (path: string) => new NextRequest(new URL(`http://orqa.test${path}`), { method: 'GET' });

describe('proxy — routes de cron', () => {
  it.each(['/api/cron/imap-poll', '/api/cron/busy-calendars'])('%s : pas de 401 sans session', async (path) => {
    expect((await proxy(req(path))).status).not.toBe(401);
  });

  it.each(['/api/cron/busy-calendarsX', '/api/cron/autre'])('%s : gardée par défaut', async (path) => {
    expect((await proxy(req(path))).status).toBe(401);
  });
});
