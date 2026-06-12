import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VivierCandidate } from '@/types/vivier';

const embeddings = { embedText: vi.fn() };
const entity = { extractVivierEntities: vi.fn() };
const variants = { runKeywordVariantsSuggestion: vi.fn() };
const repo = {
  getVivierCandidate: vi.fn(),
  setVivierIndexingStatus: vi.fn(),
  setVivierTitle: vi.fn(),
  upsertVivierTitleEmbedding: vi.fn(),
  upsertVivierEntities: vi.fn(),
};

vi.mock('@/lib/ai/embeddings', () => embeddings);
vi.mock('@/lib/vivier/entity-extraction', () => entity);
vi.mock('@/lib/agents/server/keyword-variants-execute', () => variants);
vi.mock('@/lib/db/repos/vivier', () => repo);

function candidate(overrides: Partial<VivierCandidate> = {}): VivierCandidate {
  return {
    id: 'VIV-0001',
    email: 'jane@doe.com',
    nom: 'Jane Doe',
    prenom: null,
    telephone: null,
    cvPath: 'vivier/VIV-0001/cv.pdf',
    cvFileName: 'cv-jane.pdf',
    cvText: 'un CV bien rempli',
    title: null,
    titleVariants: [],
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
  [embeddings, entity, variants, repo].forEach((m) =>
    Object.values(m).forEach((f) => f.mockReset()),
  );
  repo.setVivierIndexingStatus.mockResolvedValue(undefined);
  repo.setVivierTitle.mockResolvedValue(undefined);
  repo.upsertVivierTitleEmbedding.mockResolvedValue(undefined);
  repo.upsertVivierEntities.mockResolvedValue(undefined);
  // Défauts : extraction renvoie entités + titre ; variantes + embedding OK.
  entity.extractVivierEntities.mockResolvedValue({
    entities: ENTITIES,
    title: 'Test Manager',
  });
  variants.runKeywordVariantsSuggestion.mockResolvedValue({
    suggestedVariants: ['QA Lead', 'Responsable des tests'],
  });
  embeddings.embedText.mockResolvedValue({
    vector: [0.1, 0.2],
    provider: 'openai',
    model: 'text-embedding-3-small',
  });
});
afterEach(() => vi.restoreAllMocks());

describe('indexVivierCandidate — refonte titre', () => {
  it('chemin nominal : entités + titre + variantes + embedding titre ⇒ indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res).toEqual({ status: 'indexed', error: null });
    expect(repo.upsertVivierEntities).toHaveBeenCalledWith('VIV-0001', ENTITIES);
    expect(repo.setVivierTitle).toHaveBeenCalledWith('VIV-0001', 'Test Manager', [
      'QA Lead',
      'Responsable des tests',
    ]);
    // Variantes générées à partir du titre.
    expect(variants.runKeywordVariantsSuggestion.mock.calls[0][0].criterionLabel).toBe(
      'Test Manager',
    );
    // Embedding du TITRE (pas du CV).
    expect(embeddings.embedText).toHaveBeenCalledWith('Test Manager');
    expect(repo.upsertVivierTitleEmbedding).toHaveBeenCalledWith('VIV-0001', {
      vector: [0.1, 0.2],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
  });

  it('titre vide ⇒ ni variantes ni embedding titre, mais indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    entity.extractVivierEntities.mockResolvedValue({ entities: ENTITIES, title: null });

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(repo.setVivierTitle).toHaveBeenCalledWith('VIV-0001', null, []);
    expect(variants.runKeywordVariantsSuggestion).not.toHaveBeenCalled();
    expect(embeddings.embedText).not.toHaveBeenCalled();
    expect(repo.upsertVivierTitleEmbedding).not.toHaveBeenCalled();
  });

  it('échec génération variantes ⇒ variantes vides, embedding titre quand même, indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    variants.runKeywordVariantsSuggestion.mockRejectedValueOnce(new Error('LLM down'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(repo.setVivierTitle).toHaveBeenCalledWith('VIV-0001', 'Test Manager', []);
    // Rapprochable par l'embedding titre malgré l'échec variantes.
    expect(repo.upsertVivierTitleEmbedding).toHaveBeenCalled();
  });

  it('échec embedding titre ⇒ non bloquant, indexed (rapprochable par variantes)', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    embeddings.embedText.mockRejectedValueOnce(new Error('embed timeout'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(repo.setVivierTitle).toHaveBeenCalled();
    expect(repo.upsertVivierTitleEmbedding).not.toHaveBeenCalled();
  });

  it('erreur de transport sur l’extraction ⇒ failed (re-tentable)', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    entity.extractVivierEntities.mockRejectedValueOnce(new Error('boom réseau'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('failed');
    expect(res.error).toContain('boom réseau');
    expect(repo.setVivierIndexingStatus).toHaveBeenCalledWith(
      'VIV-0001',
      'failed',
      expect.stringContaining('boom'),
    );
  });

  it('CV sans texte ⇒ failed sans extraction', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate({ cvText: '   ' }));
    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');
    expect(res.status).toBe('failed');
    expect(entity.extractVivierEntities).not.toHaveBeenCalled();
  });

  it('dossier introuvable ⇒ failed sans mutation de statut', async () => {
    repo.getVivierCandidate.mockResolvedValue(null);
    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0404');
    expect(res.status).toBe('failed');
    expect(repo.setVivierIndexingStatus).not.toHaveBeenCalled();
  });
});
