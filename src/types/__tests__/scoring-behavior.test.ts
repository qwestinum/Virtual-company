import { describe, it, expect } from 'vitest';

import {
  SCORING_LEVELS,
  SCORING_BEHAVIORS,
  LLM_DECISIONS,
  CANDIDATE_STATUSES,
  CRITICITY_TO_BEHAVIOR,
  DECISION_OUTCOME_MATRIX,
  ScoreResultSchema,
  CriterionDecisionSchema,
  CriterionFailureSchema,
  ScoringThresholdsSchema,
  DEFAULT_SCORING_THRESHOLDS,
  BORDERLINE_REASONS,
  criterionBehavior,
  isKnockoutCriterion,
  buildCriterion,
  type ScoringBehavior,
} from '@/types/scoring';

describe('CRITICITY_TO_BEHAVIOR — mapping métier → technique', () => {
  it('exhaustivité : chacun des 6 niveaux est mappé', () => {
    expect(Object.keys(CRITICITY_TO_BEHAVIOR).sort()).toEqual(
      [...SCORING_LEVELS].sort(),
    );
    for (const level of SCORING_LEVELS) {
      expect(CRITICITY_TO_BEHAVIOR[level]).toBeDefined();
    }
  });

  it('non-ambiguïté : chaque niveau mappe vers exactement un comportement valide', () => {
    for (const level of SCORING_LEVELS) {
      expect(SCORING_BEHAVIORS).toContain(CRITICITY_TO_BEHAVIOR[level]);
    }
  });

  it('cohérence : les deux comportements HARD sont rédhibitoire et obligatoire, jamais les autres', () => {
    const hardLevels = SCORING_LEVELS.filter(
      (l) =>
        CRITICITY_TO_BEHAVIOR[l] === 'HARD_KNOCKOUT' ||
        CRITICITY_TO_BEHAVIOR[l] === 'HARD_CAP',
    );
    expect([...hardLevels].sort()).toEqual(['obligatoire', 'redhibitoire']);
    expect(CRITICITY_TO_BEHAVIOR.redhibitoire).toBe('HARD_KNOCKOUT');
    expect(CRITICITY_TO_BEHAVIOR.obligatoire).toBe('HARD_CAP');
  });

  it('cohérence : tous les niveaux non-durs sont SOFT_WEIGHTED', () => {
    for (const level of [
      'critique',
      'tres_important',
      'important',
      'souhaitable',
    ] as const) {
      expect(CRITICITY_TO_BEHAVIOR[level]).toBe('SOFT_WEIGHTED');
    }
  });

  it('SIGNAL_BONUS est défini dans le type mais inutilisé par le mapping actuel (extensibilité)', () => {
    expect(SCORING_BEHAVIORS).toContain('SIGNAL_BONUS');
    expect(Object.values(CRITICITY_TO_BEHAVIOR)).not.toContain('SIGNAL_BONUS');
  });
});

describe('criterionBehavior / isKnockoutCriterion — source unique via la table', () => {
  it('criterionBehavior délègue strictement à CRITICITY_TO_BEHAVIOR', () => {
    for (const level of SCORING_LEVELS) {
      expect(criterionBehavior(level)).toBe(CRITICITY_TO_BEHAVIOR[level]);
    }
  });

  it('isKnockoutCriterion vrai uniquement pour rédhibitoire (dérivé de la table)', () => {
    for (const level of SCORING_LEVELS) {
      const crit = buildCriterion({ id: `c_${level}`, label: level, level });
      expect(isKnockoutCriterion(crit)).toBe(level === 'redhibitoire');
    }
  });
});

describe('DECISION_OUTCOME_MATRIX — règle métier behavior × verdict', () => {
  it('exhaustivité : chaque comportement couvre les 4 décisions LLM', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      for (const decision of LLM_DECISIONS) {
        expect(DECISION_OUTCOME_MATRIX[behavior][decision]).toBeDefined();
      }
    }
  });

  it('HARD_KNOCKOUT non satisfait ⇒ knockout sec + statut knocked_out', () => {
    const o = DECISION_OUTCOME_MATRIX.HARD_KNOCKOUT.non;
    expect(o).toMatchObject({ knockout: true, forcedStatus: 'knocked_out', points: 'zero' });
  });

  it('HARD_CAP non satisfait ⇒ cap du total + statut borderline (jamais knockout)', () => {
    const o = DECISION_OUTCOME_MATRIX.HARD_CAP.non;
    expect(o).toMatchObject({ knockout: false, capsTotal: true, forcedStatus: 'borderline' });
  });

  it('un critère DUR non vérifiable ne déclenche JAMAIS d’auto-rejet (ni knockout ni cap) → borderline', () => {
    for (const behavior of ['HARD_KNOCKOUT', 'HARD_CAP'] as const) {
      const o = DECISION_OUTCOME_MATRIX[behavior].non_verifiable;
      expect(o.knockout).toBe(false);
      expect(o.capsTotal).toBe(false);
      expect(o.forcedStatus).toBe('borderline');
    }
  });

  it('SOFT_WEIGHTED n’escalade jamais le statut et ne cape jamais', () => {
    for (const decision of LLM_DECISIONS) {
      const o = DECISION_OUTCOME_MATRIX.SOFT_WEIGHTED[decision];
      expect(o.knockout).toBe(false);
      expect(o.capsTotal).toBe(false);
      expect(o.forcedStatus).toBeNull();
    }
  });

  it('SIGNAL_BONUS est bonus-only : jamais de malus, jamais d’escalade (non/non_verifiable ⇒ 0 neutre)', () => {
    expect(DECISION_OUTCOME_MATRIX.SIGNAL_BONUS.non).toMatchObject({
      points: 'zero',
      knockout: false,
      capsTotal: false,
      forcedStatus: null,
    });
    expect(DECISION_OUTCOME_MATRIX.SIGNAL_BONUS.non_verifiable.forcedStatus).toBeNull();
  });

  it('toute décision satisfait ⇒ full pts, partiel ⇒ half pts, sans escalade ni cap', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      expect(DECISION_OUTCOME_MATRIX[behavior].satisfait.points).toBe('full');
      expect(DECISION_OUTCOME_MATRIX[behavior].partiel.points).toBe('half');
      expect(DECISION_OUTCOME_MATRIX[behavior].satisfait.forcedStatus).toBeNull();
      expect(DECISION_OUTCOME_MATRIX[behavior].partiel.forcedStatus).toBeNull();
    }
  });

  it('seuls les comportements HARD peuvent forcer un statut ou caper/knockout', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      const isHard = behavior === 'HARD_KNOCKOUT' || behavior === 'HARD_CAP';
      const cells = LLM_DECISIONS.map((d) => DECISION_OUTCOME_MATRIX[behavior][d]);
      const escalates = cells.some(
        (c) => c.knockout || c.capsTotal || c.forcedStatus !== null,
      );
      expect(escalates).toBe(isHard);
    }
  });
});

describe('CandidateStatus — statuts métier à valeur aval', () => {
  it('expose exactement accepted / rejected / borderline / knocked_out', () => {
    expect([...CANDIDATE_STATUSES].sort()).toEqual(
      ['accepted', 'borderline', 'knocked_out', 'rejected'],
    );
  });
});

describe('ScoringThresholds — modèle à deux seuils', () => {
  it('accepte deux seuils avec rejection ≤ acceptance', () => {
    expect(
      ScoringThresholdsSchema.safeParse({ acceptance: 75, rejection: 50 }).success,
    ).toBe(true);
  });

  it('accepte rejection === acceptance (zone borderline vide mais cohérente)', () => {
    expect(
      ScoringThresholdsSchema.safeParse({ acceptance: 60, rejection: 60 }).success,
    ).toBe(true);
  });

  it('REJETTE rejection > acceptance', () => {
    expect(
      ScoringThresholdsSchema.safeParse({ acceptance: 50, rejection: 75 }).success,
    ).toBe(false);
  });

  it('REJETTE un seuil hors [0..100]', () => {
    expect(
      ScoringThresholdsSchema.safeParse({ acceptance: 120, rejection: 50 }).success,
    ).toBe(false);
  });

  it('le défaut cible reprend l’ancien seuil unique en acceptance (75)', () => {
    expect(DEFAULT_SCORING_THRESHOLDS.acceptance).toBe(75);
    expect(DEFAULT_SCORING_THRESHOLDS.rejection).toBeLessThanOrEqual(
      DEFAULT_SCORING_THRESHOLDS.acceptance,
    );
    expect(ScoringThresholdsSchema.safeParse(DEFAULT_SCORING_THRESHOLDS).success).toBe(
      true,
    );
  });
});

describe('BorderlineReason — typologie d’arbitrage', () => {
  it('expose les 4 raisons attendues, alignées sur la précédence', () => {
    expect([...BORDERLINE_REASONS]).toEqual([
      'hard_unverifiable',
      'hard_capped',
      'hard_cap_unverifiable',
      'score_in_uncertainty_zone',
    ]);
  });
});

describe('CriterionDecision / CriterionFailure / ScoreResult — schémas Zod', () => {
  const decision = {
    criterionId: 'crit_3',
    criterionLabel: 'Maîtrise des normes IFRS',
    criticityLevel: 'critique',
    weight: 9,
    behavior: 'SOFT_WEIGHTED',
    llmDecision: 'partiel',
    llmJustification: 'Expérience IFRS mentionnée mais sans profondeur démontrée.',
    llmCVQuote: 'Application des normes IFRS sur le périmètre groupe',
    contribution: 4.5,
  };

  it('CriterionDecision accepte une décision auditée bien formée (avec criterionId)', () => {
    expect(CriterionDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('CriterionDecision exige le criterionId (clé de jointure)', () => {
    const { criterionId: _omit, ...sansId } = decision;
    expect(CriterionDecisionSchema.safeParse(sansId).success).toBe(false);
  });

  it('CriterionDecision tolère une citation vide (critère non vérifiable)', () => {
    const r = CriterionDecisionSchema.safeParse({
      ...decision,
      llmDecision: 'non_verifiable',
      llmCVQuote: '',
    });
    expect(r.success).toBe(true);
  });

  it('CriterionFailure n’accepte que les motifs unsatisfied / unverifiable', () => {
    const base = {
      criterionId: 'crit_1',
      criterionLabel: 'Diplôme DEC',
      criticityLevel: 'redhibitoire',
    };
    expect(CriterionFailureSchema.safeParse({ ...base, reason: 'unsatisfied' }).success).toBe(true);
    expect(CriterionFailureSchema.safeParse({ ...base, reason: 'unverifiable' }).success).toBe(true);
    expect(CriterionFailureSchema.safeParse({ ...base, reason: 'whatever' }).success).toBe(false);
  });

  it('ScoreResult accepte un résultat structuré complet', () => {
    const result = {
      totalScore: 72,
      status: 'accepted',
      breakdown: [decision],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(true);
  });

  it('ScoreResult borderline EXIGE un borderlineReason (invariant)', () => {
    const base = {
      totalScore: 68,
      breakdown: [decision],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(
      ScoreResultSchema.safeParse({ ...base, status: 'borderline' }).success,
    ).toBe(false);
    expect(
      ScoreResultSchema.safeParse({
        ...base,
        status: 'borderline',
        borderlineReason: 'score_in_uncertainty_zone',
      }).success,
    ).toBe(true);
  });

  it('ScoreResult non-borderline INTERDIT un borderlineReason (invariant)', () => {
    const result = {
      totalScore: 80,
      status: 'accepted',
      borderlineReason: 'hard_capped',
      breakdown: [decision],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(false);
  });

  it('ScoreResult porte des CriterionFailure typés dans hardFailures', () => {
    const result = {
      totalScore: 0,
      status: 'knocked_out',
      breakdown: [decision],
      hardFailures: [
        {
          criterionId: 'crit_1',
          criterionLabel: 'Diplôme DEC',
          criticityLevel: 'redhibitoire',
          reason: 'unsatisfied',
        },
      ],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(true);
  });

  it('ScoreResult rejette un totalScore hors bornes [0..100]', () => {
    const bad = {
      totalScore: 140,
      status: 'accepted',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(bad).success).toBe(false);
  });

  it('ScoreResult rejette un statut hors CandidateStatus', () => {
    const bad = {
      totalScore: 50,
      status: 'scored',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(bad).success).toBe(false);
  });
});
