/**
 * Garde des routes Sourcing : lectures lancées ENSEMBLE, décision dans l'ordre
 * flag → session → campagne, rejets non consultés absorbés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourcing/flag', () => ({ isSourcingEnabled: vi.fn() }));
vi.mock('@/lib/auth/require-api-user', () => ({
  getApiUser: vi.fn(),
  unauthorizedResponse: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/sourcing-approaches', () => ({ getSourcingApproach: vi.fn(), getSourcingProfile: vi.fn() }));

import { getApiUser } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { isSourcingEnabled } from '@/lib/sourcing/flag';
import { guardSourcing, guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';

const user = { id: 'u1' };
const active = { id: 'C1', status: 'active' };
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  vi.mocked(isSourcingEnabled).mockResolvedValue(true);
  vi.mocked(getApiUser).mockResolvedValue(user as never);
  vi.mocked(getCampaign).mockResolvedValue(active as never);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.clearAllMocks();
});

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('guardSourcing', () => {
  it('flag éteint ⇒ 404 même si la session rejette (rejet absorbé)', async () => {
    vi.mocked(isSourcingEnabled).mockResolvedValue(false);
    vi.mocked(getApiUser).mockRejectedValue(new Error('cookies'));
    const g = await guardSourcing();
    await settle();
    expect(g.ok ? 200 : g.response.status).toBe(404);
    expect(unhandled).toEqual([]);
  });

  it('flag allumé, sans session ⇒ 401 ; session en erreur ⇒ rejette comme avant', async () => {
    vi.mocked(getApiUser).mockResolvedValueOnce(null);
    const g = await guardSourcing();
    expect(g.ok ? 200 : g.response.status).toBe(401);
    vi.mocked(getApiUser).mockRejectedValueOnce(new Error('cookies'));
    await expect(guardSourcing()).rejects.toThrow('cookies');
  });
});

describe('guardSourcingCampaign', () => {
  it('lance flag, session et campagne sans attendre l’un l’autre', async () => {
    let release!: (v: boolean) => void;
    vi.mocked(isSourcingEnabled).mockReturnValue(new Promise<boolean>((r) => (release = r)));
    const pending = guardSourcingCampaign('C1');
    await Promise.resolve();
    expect(getApiUser).toHaveBeenCalledTimes(1);
    expect(getCampaign).toHaveBeenCalledWith('C1');
    release(true);
    const g = await pending;
    expect(g.ok && g.value).toEqual({ user, campaign: active });
  });

  it('précédence : flag (404) > session (401) > campagne absente (404) > non active (409)', async () => {
    vi.mocked(getCampaign).mockRejectedValue(new Error('db'));
    vi.mocked(getApiUser).mockResolvedValue(null);
    vi.mocked(isSourcingEnabled).mockResolvedValueOnce(false);
    const status = async () => {
      const g = await guardSourcingCampaign('C1');
      return g.ok ? 200 : g.response.status;
    };
    expect(await status()).toBe(404);
    expect(await status()).toBe(401);
    vi.mocked(getApiUser).mockResolvedValue(user as never);
    vi.mocked(getCampaign).mockResolvedValue(null);
    expect(await status()).toBe(404);
    vi.mocked(getCampaign).mockResolvedValue({ ...active, status: 'draft' } as never);
    expect(await status()).toBe(409);
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('lecture de campagne en erreur, accès accordé ⇒ rejette comme avant', async () => {
    vi.mocked(getCampaign).mockRejectedValue(new Error('db'));
    await expect(guardSourcingCampaign('C1')).rejects.toThrow('db');
  });
});
