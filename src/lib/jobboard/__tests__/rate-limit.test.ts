import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}));

import { getServerSupabase } from '@/lib/db/supabase-server';
import { clientIp, consumeApplyQuota } from '@/lib/jobboard/rate-limit';

const mockedClient = vi.mocked(getServerSupabase);

function dbWith(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as ReturnType<typeof getServerSupabase>;
}

describe('consumeApplyQuota', () => {
  beforeEach(() => mockedClient.mockReset());

  it('laisse passer tant que le compteur rend `true`', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockedClient.mockReturnValue(dbWith(rpc));
    const verdict = await consumeApplyQuota('203.0.113.7');
    expect(verdict.allowed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'sched_rate_limit_hit',
      expect.objectContaining({ p_key: 'jobs:apply:203.0.113.7' }),
    );
  });

  it('refuse quand le plafond est atteint, avec un Retry-After exploitable', async () => {
    mockedClient.mockReturnValue(
      dbWith(vi.fn().mockResolvedValue({ data: false, error: null })),
    );
    const verdict = await consumeApplyQuota('203.0.113.7');
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('FAIL-CLOSED : compteur injoignable ⇒ on refuse (chaque envoi est un vrai mail)', async () => {
    mockedClient.mockReturnValue(null);
    expect((await consumeApplyQuota('203.0.113.7')).allowed).toBe(false);

    mockedClient.mockReturnValue(
      dbWith(vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })),
    );
    expect((await consumeApplyQuota('203.0.113.7')).allowed).toBe(false);

    mockedClient.mockReturnValue(
      dbWith(vi.fn().mockRejectedValue(new Error('réseau'))),
    );
    expect((await consumeApplyQuota('203.0.113.7')).allowed).toBe(false);
  });

  it('sans adresse : une clé COMMUNE, jamais l’absence de comptage', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockedClient.mockReturnValue(dbWith(rpc));
    await consumeApplyQuota(null);
    expect(rpc).toHaveBeenCalledWith(
      'sched_rate_limit_hit',
      expect.objectContaining({ p_key: 'jobs:apply:unknown' }),
    );
  });
});

describe('clientIp', () => {
  it('garde le PREMIER maillon de x-forwarded-for (le client)', () => {
    const req = new Request('http://x/api/jobs/apply', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    });
    expect(clientIp(req)).toBe('203.0.113.7');
  });

  it('retombe sur x-real-ip, puis null', () => {
    expect(
      clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.4' } })),
    ).toBe('198.51.100.4');
    expect(clientIp(new Request('http://x'))).toBe(null);
  });
});
