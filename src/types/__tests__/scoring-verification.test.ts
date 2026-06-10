import { describe, expect, it } from 'vitest';

import {
  buildCriterion,
  validateScoringSheet,
  VERIFICATION_METHOD_BADGES,
  type ScoringSheet,
} from '@/types/scoring';

describe('VERIFICATION_METHOD_BADGES', () => {
  it('libellé de badge par méthode', () => {
    expect(VERIFICATION_METHOD_BADGES.llm_with_quote).toBe('LLM');
    expect(VERIFICATION_METHOD_BADGES.keywords_exact).toBe('MOTS-CLÉS');
    expect(VERIFICATION_METHOD_BADGES.keywords_with_variants).toBe('MOTS-CLÉS');
    expect(VERIFICATION_METHOD_BADGES.hybrid_keywords_llm).toBe('HYBRIDE');
  });
});

function sheet(criteria: ScoringSheet['criteria']): ScoringSheet {
  return { campaignId: 'CAMP-1', criteria, isValidated: true };
}

describe('buildCriterion — méthode de vérification', () => {
  it('par défaut : pas de champ verificationMethod ni keywords (rétro-compat)', () => {
    const c = buildCriterion({ id: 'c1', label: 'Python', level: 'important' });
    expect('verificationMethod' in c).toBe(false);
    expect('keywords' in c).toBe(false);
  });

  it('matérialise les champs seulement s’ils sont fournis', () => {
    const c = buildCriterion({
      id: 'c1',
      label: 'Python',
      level: 'important',
      verificationMethod: 'keywords_with_variants',
      keywords: ['Python', 'Django'],
    });
    expect(c.verificationMethod).toBe('keywords_with_variants');
    expect(c.keywords).toEqual(['Python', 'Django']);
  });
});

describe('validateScoringSheet', () => {
  it('fiche tout-LLM (défaut) : aucune erreur', () => {
    const errs = validateScoringSheet(
      sheet([
        buildCriterion({ id: 'c1', label: 'Relationnel', level: 'important' }),
        buildCriterion({ id: 'c2', label: 'Autonomie', level: 'souhaitable' }),
      ]),
    );
    expect(errs).toEqual([]);
  });

  it('llm_with_quote sans mots-clés : accepté', () => {
    const errs = validateScoringSheet(
      sheet([
        buildCriterion({
          id: 'c1',
          label: 'Relationnel',
          level: 'important',
          verificationMethod: 'llm_with_quote',
        }),
      ]),
    );
    expect(errs).toEqual([]);
  });

  it('keywords_exact sans mot-clé : erreur claire', () => {
    const errs = validateScoringSheet(
      sheet([
        buildCriterion({
          id: 'c1',
          label: 'Certification AWS',
          level: 'redhibitoire',
          verificationMethod: 'keywords_exact',
        }),
      ]),
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/Certification AWS/);
    expect(errs[0]).toMatch(/mot-clé/);
  });

  it('mots-clés uniquement blancs : erreur (trim)', () => {
    const errs = validateScoringSheet(
      sheet([
        buildCriterion({
          id: 'c1',
          label: 'Management',
          level: 'important',
          verificationMethod: 'hybrid_keywords_llm',
          keywords: ['   ', ''],
        }),
      ]),
    );
    expect(errs).toHaveLength(1);
  });

  it('méthode déterministe avec au moins un mot-clé : accepté', () => {
    const errs = validateScoringSheet(
      sheet([
        buildCriterion({
          id: 'c1',
          label: 'React',
          level: 'important',
          verificationMethod: 'keywords_exact',
          keywords: ['React', 'ReactJS'],
        }),
      ]),
    );
    expect(errs).toEqual([]);
  });
});
