import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VivierCandidate } from '@/types/vivier';

const embeddings = { embedText: vi.fn() };
const entity = { extractVivierEntities: vi.fn() };
const repo = {
  getVivierCandidate: vi.fn(),
  setVivierIndexingStatus: vi.fn(),
  upsertVivierEmbedding: vi.fn(),
  upsertVivierEntities: vi.fn(),
};

vi.mock('@/lib/ai/embeddings', () => embeddings);
vi.mock('@/lib/vivier/entity-extraction', () => entity);
vi.mock('@/lib/db/repos/vivier', () => repo);

function candidate(overrides: Partial<VivierCandidate> = {}): VivierCandidate {
  return {
    id: 'VIV-0001',
    email: 'jane@doe.com',
    nom: 'Jane Doe',
    prenom: null,
    telephone: null,
    cvPath: 'vivier/VIV-0001/cv.pdf',
    cvText: 'un CV bien rempli',
    tags: [],
    source: 'manual_upload',
    indexingStatus: 'pending',
    indexingError: null,
    enteredAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

const ENTITIES = {
  technologies: ['Java'],
  certifications: [],
  diplomes: [],
  secteurs: [],
  langues: ['français'],
  experienceYears: 5,
  localisation: 'Lyon',
};

beforeEach(() => {
  [embeddings, entity, repo].forEach((m) =>
    Object.values(m).forEach((f) => f.mockReset()),
  );
  repo.setVivierIndexingStatus.mockResolvedValue(undefined);
  repo.upsertVivierEmbedding.mockResolvedValue(undefined);
  repo.upsertVivierEntities.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('indexVivierCandidate', () => {
  it('chemin nominal : embedding + entités + statut indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    embeddings.embedText.mockResolvedValueOnce({
      vector: [0.1, 0.2],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    entity.extractVivierEntities.mockResolvedValueOnce(ENTITIES);

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res).toEqual({ status: 'indexed', error: null });
    expect(repo.upsertVivierEmbedding).toHaveBeenCalledWith('VIV-0001', {
      vector: [0.1, 0.2],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    expect(repo.upsertVivierEntities).toHaveBeenCalledWith('VIV-0001', ENTITIES);
    expect(repo.setVivierIndexingStatus).toHaveBeenCalledWith(
      'VIV-0001',
      'indexed',
      null,
    );
  });

  it('idempotent : deux exécutions successives ⇒ indexed les deux fois', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    embeddings.embedText.mockResolvedValue({
      vector: [0.1],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    entity.extractVivierEntities.mockResolvedValue(ENTITIES);

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const a = await indexVivierCandidate('VIV-0001');
    const b = await indexVivierCandidate('VIV-0001');
    expect(a.status).toBe('indexed');
    expect(b.status).toBe('indexed');
    expect(repo.upsertVivierEmbedding).toHaveBeenCalledTimes(2);
  });

  it('échec embedding ⇒ statut failed, pas d’upsert embedding', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    embeddings.embedText.mockRejectedValueOnce(new Error('quota dépassé'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('failed');
    expect(res.error).toContain('quota dépassé');
    expect(repo.upsertVivierEmbedding).not.toHaveBeenCalled();
    expect(repo.setVivierIndexingStatus).toHaveBeenCalledWith(
      'VIV-0001',
      'failed',
      expect.stringContaining('quota'),
    );
  });

  it('échec entités (transport) ⇒ entités vides mais statut indexed (non bloquant)', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    embeddings.embedText.mockResolvedValueOnce({
      vector: [0.1],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    entity.extractVivierEntities.mockRejectedValueOnce(new Error('timeout'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    // Entités vides persistées malgré l'échec d'extraction.
    expect(repo.upsertVivierEntities).toHaveBeenCalledWith('VIV-0001', {
      technologies: [],
      certifications: [],
      diplomes: [],
      secteurs: [],
      langues: [],
      experienceYears: null,
      localisation: null,
    });
    expect(repo.setVivierIndexingStatus).toHaveBeenCalledWith(
      'VIV-0001',
      'indexed',
      null,
    );
  });

  it('CV sans texte ⇒ failed sans appel embedding', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate({ cvText: '   ' }));
    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');
    expect(res.status).toBe('failed');
    expect(embeddings.embedText).not.toHaveBeenCalled();
  });

  it('dossier introuvable ⇒ failed sans mutation de statut', async () => {
    repo.getVivierCandidate.mockResolvedValue(null);
    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0404');
    expect(res.status).toBe('failed');
    expect(repo.setVivierIndexingStatus).not.toHaveBeenCalled();
  });
});
