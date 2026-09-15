import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/scheduling-host/busy/refresh', () => ({
  refreshBusyCalendars: vi.fn(),
}));

import { GET } from '@/app/api/cron/busy-calendars/route';
import { refreshBusyCalendars } from '@/lib/scheduling-host/busy/refresh';

const refreshMock = vi.mocked(refreshBusyCalendars);
const REPORT = {
  enabled: true,
  recruiters: 2,
  ok: 1,
  failed: 1,
  skippedInactive: 0,
  skippedClaimed: 0,
  deferred: 0,
  durationMs: 12,
};

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/cron/busy-calendars', { method: 'GET', headers });

describe('GET /api/cron/busy-calendars', () => {
  const prev = process.env.CRON_SECRET;
  beforeEach(() => {
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(REPORT);
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it('FAIL-CLOSED : sans CRON_SECRET → 500, aucune relève', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer quoi que ce soit' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('cron_not_configured');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('401 sans Bearer ou avec un mauvais', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer nope' }))).status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('relève et rend les compteurs', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    const res = await GET(req({ authorization: 'Bearer s3cr3t' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, calendars: REPORT });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('dit quand la passe elle-même a échoué (500), sans détail', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    refreshMock.mockResolvedValue({ ...REPORT, error: 'refresh_failed' });
    const res = await GET(req({ authorization: 'Bearer s3cr3t' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, calendars: { error: 'refresh_failed' } });
  });
});
