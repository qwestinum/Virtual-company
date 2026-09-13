/**
 * Flag du module Sourcing — deux étages, FAIL-CLOSED.
 * Module éteint ⇒ TOUTES les routes répondent 404, avant même l'authentification
 * (un 401 ou un 403 confirmerait la surface), et aucune n'appelle le moteur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/app-settings', () => ({ getAppSettings: vi.fn() }));
vi.mock('@/lib/auth/require-api-user', () => ({
  getApiUser: vi.fn(),
  unauthorizedResponse: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
}));
vi.mock('@/lib/sourcing/server/exa', async (orig) => ({
  ...(await orig<typeof import('@/lib/sourcing/server/exa')>()),
  searchPeople: vi.fn(),
}));

import { GET as listCampaigns } from '@/app/api/sourcing/campaigns/route';
import { GET as listProfiles, POST as moreProfiles } from '@/app/api/sourcing/campaigns/[id]/profiles/route';
import { POST as generateQuery } from '@/app/api/sourcing/campaigns/[id]/query/route';
import { POST as runSearch } from '@/app/api/sourcing/campaigns/[id]/searches/route';
import { getApiUser } from '@/lib/auth/require-api-user';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { isSourcingDeploymentEnabled } from '@/lib/sourcing/flag';
import { searchPeople } from '@/lib/sourcing/server/exa';

const ENV_KEYS = ['SOURCING_ENABLED', 'EXA_API_KEY', 'SOURCING_FINGERPRINT_PEPPER'] as const;
const saved: Record<string, string | undefined> = {};
const params = { params: Promise.resolve({ id: 'CAMP-2026-001' }) };
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

const allRoutes = () => [
  listCampaigns(),
  listProfiles(new Request('http://x'), params),
  moreProfiles(post({}), params),
  generateQuery(post({ language: 'fr' }), params),
  runSearch(post({ query: 'Consultant AMOA à Paris', queryGenerated: '', queryMethod: 'llm', language: 'fr' }), params),
];

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SOURCING_ENABLED = '1';
  process.env.EXA_API_KEY = 'cle-de-test';
  process.env.SOURCING_FINGERPRINT_PEPPER = 'sel-de-test';
  vi.mocked(getApiUser).mockResolvedValue({ id: 'u1', email: 'r@x.fr' } as never);
  vi.mocked(getAppSettings).mockResolvedValue({ sourcingConfig: { enabled: true, defaultLanguage: 'fr' } } as never);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('étage 1 — déploiement', () => {
  it('exige les trois variables, et « 1 » strictement', () => {
    const base = { SOURCING_ENABLED: '1', EXA_API_KEY: 'k', SOURCING_FINGERPRINT_PEPPER: 'p' };
    expect(isSourcingDeploymentEnabled(base)).toBe(true);
    for (const value of ['', '0', 'true', 'yes', ' ']) {
      expect(isSourcingDeploymentEnabled({ ...base, SOURCING_ENABLED: value }), value).toBe(false);
    }
    expect(isSourcingDeploymentEnabled({ ...base, EXA_API_KEY: '  ' })).toBe(false);
    expect(isSourcingDeploymentEnabled({ ...base, SOURCING_FINGERPRINT_PEPPER: undefined })).toBe(false);
  });
});

describe('module éteint ⇒ 404 partout, sans appel au moteur', () => {
  const statuses = async () => (await Promise.all(allRoutes())).map((r) => r.status);

  it('variable SOURCING_ENABLED absente', async () => {
    delete process.env.SOURCING_ENABLED;
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('clé du moteur absente', async () => {
    delete process.env.EXA_API_KEY;
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('sel des empreintes absent', async () => {
    delete process.env.SOURCING_FINGERPRINT_PEPPER;
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('réglage du cabinet éteint', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ sourcingConfig: { enabled: false, defaultLanguage: 'fr' } } as never);
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('réglages illisibles (base injoignable) ⇒ éteint', async () => {
    vi.mocked(getAppSettings).mockResolvedValue(null);
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('404 AVANT l’authentification : un visiteur non connecté n’apprend rien', async () => {
    delete process.env.SOURCING_ENABLED;
    vi.mocked(getApiUser).mockResolvedValue(null);
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);
  });

  it('le moteur n’a jamais été appelé', () => {
    expect(vi.mocked(searchPeople)).not.toHaveBeenCalled();
  });
});

describe('module allumé', () => {
  it('sans session ⇒ 401 (la surface existe, l’accès non)', async () => {
    vi.mocked(getApiUser).mockResolvedValue(null);
    expect((await listCampaigns()).status).toBe(401);
  });
});
