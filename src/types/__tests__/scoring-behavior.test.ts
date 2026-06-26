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
  criterionBehavior,
  isKnockoutCriterion,
  buildCriterion,
} from '@/types/scoring';

describe('CRITICITY_TO_BEHAVIOR — mapping métier → technique', () => {
  it('exhaustivité : chacun des niveaux est mappé', () => {
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

  it('cohérence : le SEUL niveau dur restant est rédhibitoire (obligatoire retiré)', () => {
    const hardLevels = SCORING_LEVELS.filter(
      (l) =>
        CRITICITY_TO_BEHAVIOR[l] === 'HARD_KNOCKOUT' ||
        CRITICITY_TO_BEHAVIOR[l] === 'HARD_CAP',
    );
    expect([...hardLevels].sort()).toEqual(['redhibitoire']);
    expect(CRITICITY_TO_BEHAVIOR.redhibitoire).toBe('HARD_KNOCKOUT');
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

  it('HARD_CAP et SIGNAL_BONUS sont définis dans le type mais DORMANTS (aucun niveau ne s’y mappe)', () => {
    expect(SCORING_BEHAVIORS).toContain('SIGNAL_BONUS');
    expect(SCORING_BEHAVIORS).toContain('HARD_CAP');
    const mapped = Object.values(CRITICITY_TO_BEHAVIOR);
    expect(mapped).not.toContain('SIGNAL_BONUS');
    expect(mapped).not.toContain('HARD_CAP');
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

describe('DECISION_OUTCOME_MATRIX — règle métier behavior × verdict (modèle 2 statuts)', () => {
  it('exhaustivité : chaque comportement couvre les 4 décisions LLM', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      for (const decision of LLM_DECISIONS) {
        expect(DECISION_OUTCOME_MATRIX[behavior][decision]).toBeDefined();
      }
    }
  });

  it('HARD_KNOCKOUT non OU non_verifiable ⇒ knockout + statut forcé rejected', () => {
    for (const decision of ['non', 'non_verifiable'] as const) {
      const o = DECISION_OUTCOME_MATRIX.HARD_KNOCKOUT[decision];
      expect(o).toMatchObject({ knockout: true, forcedStatus: 'rejected', points: 'zero' });
      expect(o.capsTotal).toBe(false);
    }
  });

  it('HARD_CAP non OU non_verifiable ⇒ cap du total, sans statut forcé (le seuil rejette)', () => {
    for (const decision of ['non', 'non_verifiable'] as const) {
      const o = DECISION_OUTCOME_MATRIX.HARD_CAP[decision];
      expect(o).toMatchObject({ knockout: false, capsTotal: true, forcedStatus: null });
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

  it('SIGNAL_BONUS est bonus-only : jamais de malus, jamais d’escalade', () => {
    for (const decision of LLM_DECISIONS) {
      const o = DECISION_OUTCOME_MATRIX.SIGNAL_BONUS[decision];
      expect(o.knockout).toBe(false);
      expect(o.capsTotal).toBe(false);
      expect(o.forcedStatus).toBeNull();
    }
    expect(DECISION_OUTCOME_MATRIX.SIGNAL_BONUS.non.points).toBe('zero');
  });

  it('satisfait ⇒ full pts, partiel ⇒ half pts, sans escalade ni cap', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      expect(DECISION_OUTCOME_MATRIX[behavior].satisfait.points).toBe('full');
      expect(DECISION_OUTCOME_MATRIX[behavior].partiel.points).toBe('half');
      expect(DECISION_OUTCOME_MATRIX[behavior].satisfait.forcedStatus).toBeNull();
      expect(DECISION_OUTCOME_MATRIX[behavior].partiel.forcedStatus).toBeNull();
    }
  });

  it('seuls les comportements HARD peuvent caper, knockouter ou forcer un statut', () => {
    for (const behavior of SCORING_BEHAVIORS) {
      const isHard = behavior === 'HARD_KNOCKOUT' || behavior === 'HARD_CAP';
      const cells = LLM_DECISIONS.map((d) => DECISION_OUTCOME_MATRIX[behavior][d]);
      const escalates = cells.some(
        (c) => c.knockout || c.capsTotal || c.forcedStatus !== null,
      );
      expect(escalates).toBe(isHard);
    }
  });

  it('le seul statut jamais forcé que par un knockout est rejected', () => {
    const forced = SCORING_BEHAVIORS.flatMap((b) =>
      LLM_DECISIONS.map((d) => DECISION_OUTCOME_MATRIX[b][d].forcedStatus),
    ).filter((s): s is 'rejected' => s !== null);
    expect(forced.every((s) => s === 'rejected')).toBe(true);
  });
});

describe('CandidateStatus — modèle à 2 statuts', () => {
  it('expose exactement accepted / rejected', () => {
    expect([...CANDIDATE_STATUSES].sort()).toEqual(['accepted', 'rejected']);
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

  it('ScoreResult accepte un résultat accepted structuré complet', () => {
    const result = {
      totalScore: 82,
      status: 'accepted',
      breakdown: [decision],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(true);
  });

  it('ScoreResult tolère un score ÉLEVÉ avec statut rejected (knockout, score conservé)', () => {
    const result = {
      totalScore: 88,
      status: 'rejected',
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

  it('ScoreResult impose un totalScore ENTIER', () => {
    const bad = {
      totalScore: 72.5,
      status: 'accepted',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-05T10:00:00.000Z',
    };
    expect(ScoreResultSchema.safeParse(bad).success).toBe(false);
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

  it('ScoreResult rejette un statut supprimé (borderline / knocked_out)', () => {
    for (const status of ['borderline', 'knocked_out', 'pending_info']) {
      const bad = {
        totalScore: 50,
        status,
        breakdown: [],
        hardFailures: [],
        criteriaVersion: 'v1',
        computedAt: '2026-06-05T10:00:00.000Z',
      };
      expect(ScoreResultSchema.safeParse(bad).success).toBe(false);
    }
  });
});
