import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIValidationError } from '@/lib/ai/errors';

const chatCompleteJsonMock = vi.fn();

vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

function jsonResult(data: unknown) {
  return {
    data,
    raw: {
      content: JSON.stringify(data),
      model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costEstimate: 0.001,
      durationMs: 12,
    },
    attempts: 1,
  };
}

const FULL = {
  technologies: ['Java', 'React'],
  certifications: ['ISTQB'],
  diplomes: ['Master informatique'],
  secteurs: ['banque'],
  langues: ['français', 'anglais'],
  experienceYears: 8,
  localisation: 'Paris',
};

describe('extractVivierEntities', () => {
  beforeEach(() => chatCompleteJsonMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('mappe une extraction valide et nettoie les listes', async () => {
    chatCompleteJsonMock.mockResolvedValueOnce(
      jsonResult({
        ...FULL,
        technologies: ['Java', ' java ', 'React', ''],
        localisation: '  Paris  ',
      }),
    );
    const { extractVivierEntities } = await import('@/lib/vivier/entity-extraction');
    const out = await extractVivierEntities('cv text', 'cv.pdf');
    // Déduplication insensible casse + trim + retrait des vides.
    expect(out.technologies).toEqual(['Java', 'React']);
    expect(out.certifications).toEqual(['ISTQB']);
    expect(out.experienceYears).toBe(8);
    expect(out.localisation).toBe('Paris');
  });

  it('échec de validation LLM ⇒ entités vides, sans lever (non bloquant)', async () => {
    chatCompleteJsonMock.mockRejectedValueOnce(
      new AIValidationError('invalide', 3, null),
    );
    const { extractVivierEntities } = await import('@/lib/vivier/entity-extraction');
    const out = await extractVivierEntities('cv text', 'cv.pdf');
    expect(out).toEqual({
      technologies: [],
      certifications: [],
      diplomes: [],
      secteurs: [],
      langues: [],
      experienceYears: null,
      localisation: null,
    });
  });

  it('erreur de transport ⇒ propagée (décision laissée au service d’indexation)', async () => {
    chatCompleteJsonMock.mockRejectedValueOnce(new Error('boom réseau'));
    const { extractVivierEntities } = await import('@/lib/vivier/entity-extraction');
    await expect(extractVivierEntities('cv text', 'cv.pdf')).rejects.toThrow(
      /boom réseau/,
    );
  });
});
