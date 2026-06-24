import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return {
    ...actual,
    requireServerSupabase: vi.fn(),
  };
});

import { archiveFdp, searchFdps } from '@/lib/db/repos/fdps-archived';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { FDPInProgress } from '@/types/field-collection';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

function buildFdp(overrides: Record<string, string> = {}): FDPInProgress {
  const mk = (value: string) =>
    ({
      key: 'job_title',
      label: '',
      status: 'filled' as const,
      required: true,
      value,
    }) as never;
  return {
    campaignId: 'CAMP-0001',
    fields: {
      job_title: mk(overrides.job_title ?? 'Comptable senior'),
      seniority: mk(overrides.seniority ?? 'senior'),
      contract_type: mk(overrides.contract_type ?? 'CDI'),
      location: mk(overrides.location ?? 'Paris'),
      salary_range: mk('50-65k€'),
      start_date: mk('2026-06-01'),
      main_missions: mk('mission'),
      key_skills: mk('compta'),
    } as never,
    isComplete: true,
    isValidated: true,
  };
}

describe('fdps-archived repo', () => {
  beforeEach(() => {
    requireServerSupabaseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archiveFdp extracts indexed fields from the FDP', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    await archiveFdp('CAMP-0001', buildFdp());

    expect(from).toHaveBeenCalledWith('fdps_archived');
    const row = upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.campaign_id).toBe('CAMP-0001');
    expect(row.job_title).toBe('Comptable senior');
    expect(row.seniority).toBe('senior');
    expect(row.contract_type).toBe('CDI');
    expect(row.location).toBe('Paris');
  });

  it('archiveFdp JOINT un contrat MULTI-valeur dans la colonne (non-régression)', async () => {
    // Régression visée : avant le passage multi-valeur, `extractField` faisait
    // `typeof v === 'string'` → renvoyait null sur un tableau → PERTE silencieuse
    // de la colonne archive. Désormais on joint (« CDI, CDD »).
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const fdp = buildFdp();
    (fdp.fields.contract_type as { value: unknown }).value = ['CDI', 'CDD'];

    await archiveFdp('CAMP-0001', fdp);

    const row = upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.contract_type).toBe('CDI, CDD'); // joint, PAS null
  });

  it('searchFdps returns [] for queries shorter than 2 chars', async () => {
    const from = vi.fn();
    requireServerSupabaseMock.mockReturnValue({ from } as never);
    expect(await searchFdps('a')).toEqual([]);
    expect(await searchFdps('')).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('searchFdps tokenizes the query and OR-ilike on tokens', async () => {
    // La requête type Manager : phrase complète du user. On veut que
    // « comptable » et « senior » génèrent un OR ilike, et que les
    // stopwords (je, veux, pour, à) soient ignorés.
    const orMock = vi.fn().mockResolvedValue({
      data: [
        {
          campaign_id: 'CAMP-0001',
          job_title: 'Comptable senior',
          seniority: 'senior',
          contract_type: 'CDI',
          location: 'Paris',
          fdp: {
            campaignId: 'CAMP-0001',
            fields: {},
            isComplete: true,
            isValidated: true,
          },
          archived_at: '2026-05-01T00:00:00Z',
        },
      ],
      error: null,
    });
    const limit = vi.fn().mockReturnValue({ or: orMock });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const hits = await searchFdps('je veux recruter un comptable senior à Paris');

    const orArg = orMock.mock.calls[0]![0] as string;
    expect(orArg).toContain('job_title.ilike.%comptable%');
    expect(orArg).toContain('job_title.ilike.%senior%');
    expect(orArg).toContain('job_title.ilike.%paris%');
    // Les stopwords doivent être absents.
    expect(orArg).not.toContain('job_title.ilike.%veux%');
    expect(orArg).not.toContain('job_title.ilike.%pour%');
    expect(orArg).not.toContain('job_title.ilike.%recruter%');

    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe('Comptable senior');
  });

  it('searchFdps falls back to substring ilike when query is 100% stopwords', async () => {
    // « je veux pour » → tous filtrés → fallback ilike sur la chaîne
    // entière. Préserve le chemin proper-noun court (« CTO » seul aurait
    // moins de 3 chars et serait jeté aussi).
    const ilike = vi.fn().mockResolvedValue({ data: [], error: null });
    const limit = vi.fn().mockReturnValue({ ilike });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    await searchFdps('je veux pour');
    expect(ilike).toHaveBeenCalledWith('job_title', '%je veux pour%');
  });
});
