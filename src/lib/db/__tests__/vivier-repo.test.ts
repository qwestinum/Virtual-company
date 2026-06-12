import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/supabase-server')>(
    '@/lib/db/supabase-server',
  );
  return { ...actual, requireServerSupabase: vi.fn() };
});

import {
  listVivierCandidates,
  toVectorLiteral,
  upsertVivierEmbedding,
  vivierEntitiesRowToDomain,
  vivierRowToDomain,
} from '@/lib/db/repos/vivier';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { VivierCandidateRow, VivierEntitiesRow } from '@/lib/db/types';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

beforeEach(() => requireServerSupabaseMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('mappers purs', () => {
  it('vivierRowToDomain mappe snake_case → camelCase', () => {
    const row: VivierCandidateRow = {
      id: 'VIV-0001',
      email: 'jane@doe.com',
      nom: 'Jane Doe',
      prenom: null,
      telephone: '0600',
      cv_path: 'vivier/VIV-0001/cv.pdf',
      cv_file_name: 'jane.pdf',
      cv_text: 'texte',
      title: 'Test Manager',
      title_variants: ['QA Lead'],
      tags: ['devops'],
      source: 'manual_upload',
      indexing_status: 'indexed',
      indexing_error: null,
      entered_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-02T00:00:00Z',
    };
    expect(vivierRowToDomain(row)).toEqual({
      id: 'VIV-0001',
      email: 'jane@doe.com',
      nom: 'Jane Doe',
      prenom: null,
      telephone: '0600',
      cvPath: 'vivier/VIV-0001/cv.pdf',
      cvFileName: 'jane.pdf',
      cvText: 'texte',
      title: 'Test Manager',
      titleVariants: ['QA Lead'],
      tags: ['devops'],
      source: 'manual_upload',
      indexingStatus: 'indexed',
      indexingError: null,
      enteredAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-02T00:00:00Z',
    });
  });

  it('vivierRowToDomain tolère un résumé sans cv_text', () => {
    const summary = {
      id: 'VIV-0002',
      email: 'a@b.com',
      nom: 'A',
      prenom: null,
      telephone: null,
      cv_path: null,
      cv_file_name: null,
      title: null,
      title_variants: [],
      tags: [],
      source: 'manual_upload' as const,
      indexing_status: 'pending' as const,
      indexing_error: null,
      entered_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };
    expect(vivierRowToDomain(summary).cvText).toBeNull();
  });

  it('vivierEntitiesRowToDomain mappe les entités', () => {
    const row: VivierEntitiesRow = {
      candidate_id: 'VIV-0001',
      technologies: ['Java'],
      certifications: ['ISTQB'],
      diplomes: [],
      secteurs: ['banque'],
      langues: ['fr'],
      experience_years: 7,
      localisation: 'Paris',
      extracted_at: '2026-06-01T00:00:00Z',
    };
    expect(vivierEntitiesRowToDomain(row)).toEqual({
      technologies: ['Java'],
      certifications: ['ISTQB'],
      diplomes: [],
      secteurs: ['banque'],
      langues: ['fr'],
      experienceYears: 7,
      localisation: 'Paris',
    });
  });
});

describe('toVectorLiteral', () => {
  it('sérialise au format littéral pgvector', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
    expect(toVectorLiteral([])).toBe('[]');
  });
});

describe('listVivierCandidates', () => {
  function makeQuery(result: unknown) {
    const q: Record<string, unknown> = {
      eq: vi.fn(() => q),
      or: vi.fn(() => q),
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return q;
  }

  it('mappe les lignes et renvoie le total (count)', async () => {
    const result = {
      data: [
        {
          id: 'VIV-0001',
          email: 'jane@doe.com',
          nom: 'Jane Doe',
          prenom: null,
          telephone: null,
          cv_path: 'vivier/VIV-0001/cv.pdf',
          tags: [],
          source: 'manual_upload',
          indexing_status: 'indexed',
          indexing_error: null,
          entered_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T00:00:00Z',
        },
      ],
      error: null,
      count: 42,
    };
    const range = vi.fn(() => makeQuery(result));
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const out = await listVivierCandidates({ limit: 10, offset: 0 });
    expect(from).toHaveBeenCalledWith('vivier_candidates');
    expect(out.total).toBe(42);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.id).toBe('VIV-0001');
    expect(out.items[0]!.cvText).toBeNull();
  });
});

describe('upsertVivierEmbedding', () => {
  it('insère le vecteur au format littéral + provider/model', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    await upsertVivierEmbedding('VIV-0001', {
      vector: [0.1, 0.2],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });

    expect(from).toHaveBeenCalledWith('vivier_embeddings');
    const [payload, opts] = upsert.mock.calls[0]!;
    expect(payload.candidate_id).toBe('VIV-0001');
    expect(payload.embedding).toBe('[0.1,0.2]');
    expect(payload.provider).toBe('openai');
    expect(opts).toEqual({ onConflict: 'candidate_id' });
  });
});
