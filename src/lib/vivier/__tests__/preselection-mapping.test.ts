import { describe, expect, it } from 'vitest';

import {
  buildVivierQueryText,
  candidatePassesHardFilters,
  freshnessFactor,
  selectHardFilters,
} from '@/lib/vivier/preselection';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';
import { EMPTY_VIVIER_ENTITIES, type VivierEntities } from '@/types/vivier';

function entities(over: Partial<VivierEntities> = {}): VivierEntities {
  return { ...EMPTY_VIVIER_ENTITIES, ...over };
}

function sheet(criteria: ScoringSheet['criteria']): ScoringSheet {
  return { campaignId: 'CAMP-1', isValidated: true, criteria };
}

function fdpWith(values: Record<string, unknown>): FDPInProgress {
  const fdp = buildEmptyFDP('CAMP-1');
  for (const [k, v] of Object.entries(values)) {
    const key = k as keyof typeof fdp.fields;
    if (fdp.fields[key]) fdp.fields[key] = { ...fdp.fields[key], value: v };
  }
  return fdp;
}

describe('selectHardFilters', () => {
  it('retient les critères durs (redhibitoire/obligatoire) AVEC mots-clés', () => {
    const filters = selectHardFilters(
      sheet([
        buildCriterion({
          id: 'k1',
          label: 'Java',
          level: 'redhibitoire',
          verificationMethod: 'keywords_exact',
          keywords: ['Java'],
        }),
        buildCriterion({
          id: 'k2',
          label: 'Diplôme bac+5',
          level: 'obligatoire',
          verificationMethod: 'keywords_with_variants',
          keywords: ['Master', 'Ingénieur'],
        }),
      ]),
    );
    expect(filters.map((f) => f.criterionId)).toEqual(['k1', 'k2']);
    expect(filters[1].keywords).toEqual(['Master', 'Ingénieur']);
  });

  it('ignore un critère dur SANS mots-clés (non mappable sur les entités)', () => {
    const filters = selectHardFilters(
      sheet([
        buildCriterion({ id: 'k', label: 'Sens du service', level: 'redhibitoire' }),
      ]),
    );
    expect(filters).toEqual([]);
  });

  it('ignore les critères souples même avec mots-clés', () => {
    const filters = selectHardFilters(
      sheet([
        buildCriterion({
          id: 's',
          label: 'IFRS',
          level: 'critique',
          verificationMethod: 'keywords_exact',
          keywords: ['IFRS'],
        }),
      ]),
    );
    expect(filters).toEqual([]);
  });
});

describe('candidatePassesHardFilters', () => {
  const filters = selectHardFilters(
    sheet([
      buildCriterion({
        id: 'k1',
        label: 'Java',
        level: 'redhibitoire',
        verificationMethod: 'keywords_exact',
        keywords: ['Java'],
      }),
    ]),
  );

  it('sans filtre dur, tout le monde passe', () => {
    const r = candidatePassesHardFilters(entities(), []);
    expect(r.passed).toBe(true);
    expect(r.matches).toEqual([]);
  });

  it('un critère dur satisfait (mot-clé présent dans le pool d’entités)', () => {
    const r = candidatePassesHardFilters(
      entities({ technologies: ['Java', 'Spring'] }),
      filters,
    );
    expect(r.passed).toBe(true);
    expect(r.matches[0]).toEqual({
      criterionId: 'k1',
      label: 'Java',
      matchedTerms: ['Java'],
    });
  });

  it('un critère dur non satisfait élimine le candidat', () => {
    const r = candidatePassesHardFilters(
      entities({ technologies: ['Python'] }),
      filters,
    );
    expect(r.passed).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it('le pool couvre toutes les entités dures (ex. mot-clé trouvé dans diplômes)', () => {
    const diplomeFilter = selectHardFilters(
      sheet([
        buildCriterion({
          id: 'd',
          label: 'Master',
          level: 'obligatoire',
          verificationMethod: 'keywords_exact',
          keywords: ['Master'],
        }),
      ]),
    );
    const r = candidatePassesHardFilters(
      entities({ diplomes: ['Master informatique'] }),
      diplomeFilter,
    );
    expect(r.passed).toBe(true);
    expect(r.matches[0].matchedTerms).toEqual(['Master']);
  });
});

describe('buildVivierQueryText', () => {
  it('combine champs FDP métier + libellés des critères triés par poids décroissant', () => {
    const text = buildVivierQueryText(
      fdpWith({
        job_title: 'Développeur backend',
        key_skills: 'Java, SQL',
        main_missions: 'API REST', // exclu volontairement de la requête
      }),
      sheet([
        buildCriterion({ id: 'a', label: 'SQL', level: 'important', weight: 4 }),
        buildCriterion({ id: 'b', label: 'Java', level: 'critique', weight: 8 }),
      ]),
    );
    const lines = text.split('\n');
    expect(lines).toContain('Développeur backend');
    expect(lines).toContain('Java, SQL'); // key_skills inclus
    // main_missions n'est PAS injecté (prose générique qui tasse la similarité).
    expect(text).not.toContain('API REST');
    // Java (poids 8) avant SQL (poids 4).
    expect(lines.indexOf('Java')).toBeLessThan(lines.indexOf('SQL'));
  });
});

describe('freshnessFactor', () => {
  const now = Date.parse('2027-12-01T00:00:00Z');

  it('dossier récent (≤ 12 mois) ⇒ facteur 1', () => {
    expect(freshnessFactor('2027-06-01T00:00:00Z', now)).toBe(1);
  });

  it('dossier de ~18 mois ⇒ dégressif (~0.7)', () => {
    expect(freshnessFactor('2026-06-01T00:00:00Z', now)).toBeCloseTo(0.7, 1);
  });

  it('dossier très ancien ⇒ plancher 0.5', () => {
    expect(freshnessFactor('2020-01-01T00:00:00Z', now)).toBe(0.5);
  });

  it('date illisible ⇒ pas de pénalité (1)', () => {
    expect(freshnessFactor('pas-une-date', now)).toBe(1);
  });
});
