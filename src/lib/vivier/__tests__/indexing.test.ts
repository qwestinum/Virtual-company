import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VivierCandidate } from '@/types/vivier';

const embeddings = { embedText: vi.fn() };
const entity = { extractVivierEntities: vi.fn() };
const variants = { runTitleVariantsSuggestion: vi.fn() };
const repo = {
  getVivierCandidate: vi.fn(),
  listDistinctEmbeddingModels: vi.fn(),
  setVivierIndexingStatus: vi.fn(),
  setVivierTitle: vi.fn(),
  upsertVivierTitleEmbedding: vi.fn(),
  upsertVivierEntities: vi.fn(),
  setVivierSkills: vi.fn(),
  replaceSkillEmbeddings: vi.fn(),
  setVivierTitleAnchors: vi.fn(),
};

vi.mock('@/lib/ai/embeddings', () => embeddings);
vi.mock('@/lib/vivier/entity-extraction', () => entity);
vi.mock('@/lib/agents/server/title-variants-execute', () => variants);
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
  repo.setVivierSkills.mockResolvedValue(undefined);
  repo.replaceSkillEmbeddings.mockResolvedValue(undefined);
  repo.setVivierTitleAnchors.mockResolvedValue(undefined);
  // Défaut : index homogène, aligné sur le modèle de l'embedding mocké.
  repo.listDistinctEmbeddingModels.mockResolvedValue(['openai|text-embedding-3-small']);
  // Défauts : extraction renvoie entités + titre + compétences + 2 derniers postes.
  entity.extractVivierEntities.mockResolvedValue({
    entities: ENTITIES,
    title: 'Test Manager',
    skills: ['Java', 'gestion d’équipe'],
    recentPositions: ['QA Lead', 'Testeur'],
  });
  variants.runTitleVariantsSuggestion.mockResolvedValue({
    variants: ['QA Lead', 'Responsable des tests'],
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
    // Variantes ISO-RÔLE générées à partir des blocs du titre (ici 1 bloc).
    expect(variants.runTitleVariantsSuggestion).toHaveBeenCalledWith(['Test Manager']);
    // Embedding du TITRE (pas du CV).
    expect(embeddings.embedText).toHaveBeenCalledWith('Test Manager');
    expect(repo.upsertVivierTitleEmbedding).toHaveBeenCalledWith('VIV-0001', {
      vector: [0.1, 0.2],
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    // Compétences : liste posée + un embedding par compétence.
    expect(repo.setVivierSkills).toHaveBeenCalledWith('VIV-0001', [
      'Java',
      'gestion d’équipe',
    ]);
    expect(embeddings.embedText).toHaveBeenCalledWith('Java');
    expect(embeddings.embedText).toHaveBeenCalledWith('gestion d’équipe');
    expect(repo.replaceSkillEmbeddings).toHaveBeenCalledTimes(1);
    // Ancres : titre déclaré (depth 0) + 2 derniers postes (depth 1, 2).
    expect(repo.setVivierTitleAnchors).toHaveBeenCalledTimes(1);
    const anchors = repo.setVivierTitleAnchors.mock.calls[0][1] as {
      text: string;
      depth: number;
      terms: string[];
    }[];
    expect(anchors.map((a) => ({ text: a.text, depth: a.depth }))).toEqual([
      { text: 'Test Manager', depth: 0 },
      { text: 'QA Lead', depth: 1 },
      { text: 'Testeur', depth: 2 },
    ]);
    // depth 0 réutilise les variantes du déclaré (pas de re-génération).
    expect(anchors[0].terms).toContain('QA Lead');
  });

  it('espace d’embeddings mélangé ⇒ avertit fort mais reste indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    // L'index contient déjà du large alors qu'on vient d'écrire du small.
    repo.listDistinctEmbeddingModels.mockResolvedValue([
      'openai|text-embedding-3-small',
      'openai|text-embedding-3-large',
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('text-embedding-3-large');
    expect(warn.mock.calls[0][0]).toContain('embedding_model_mismatch');
  });

  it('index homogène ⇒ aucun avertissement', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    await indexVivierCandidate('VIV-0001');

    expect(warn).not.toHaveBeenCalled();
  });

  it('contrôle d’espace indisponible ⇒ n’altère pas l’indexation', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    repo.listDistinctEmbeddingModels.mockRejectedValueOnce(new Error('base injoignable'));

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(repo.upsertVivierTitleEmbedding).toHaveBeenCalled();
  });

  it('titre vide ⇒ ni variantes ni embedding titre, mais indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    entity.extractVivierEntities.mockResolvedValue({
      entities: ENTITIES,
      title: null,
      skills: [],
      recentPositions: [],
    });

    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const res = await indexVivierCandidate('VIV-0001');

    expect(res.status).toBe('indexed');
    expect(repo.setVivierTitle).toHaveBeenCalledWith('VIV-0001', null, []);
    expect(variants.runTitleVariantsSuggestion).not.toHaveBeenCalled();
    expect(embeddings.embedText).not.toHaveBeenCalled();
    expect(repo.upsertVivierTitleEmbedding).not.toHaveBeenCalled();
  });

  it('échec génération variantes ⇒ variantes vides, embedding titre quand même, indexed', async () => {
    repo.getVivierCandidate.mockResolvedValue(candidate());
    variants.runTitleVariantsSuggestion.mockRejectedValueOnce(new Error('LLM down'));

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
