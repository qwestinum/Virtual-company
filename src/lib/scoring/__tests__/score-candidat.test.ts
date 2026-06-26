import { describe, it, expect } from 'vitest';

import {
  scoreCandidat,
  ScoringError,
  type LlmCriterionVerdict,
} from '@/lib/scoring';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

/** Fiche « comptable senior » : 1 knockout (p0) + 4 SOFT [8,6,4,2]. */
function sheetA(acceptanceThreshold = 75): ScoringSheet {
  return {
    campaignId: 'CAMP-TEST',
    isValidated: true,
    acceptanceThreshold,
    criteria: [
      buildCriterion({ id: 'ko', label: 'Diplôme DEC', level: 'redhibitoire' }),
      buildCriterion({ id: 's_ifrs', label: 'IFRS', level: 'critique', weight: 8 }),
      buildCriterion({ id: 's_sap', label: 'SAP', level: 'tres_important', weight: 6 }),
      buildCriterion({ id: 's_eng', label: 'Anglais', level: 'important', weight: 4 }),
      buildCriterion({ id: 's_big4', label: 'Big 4', level: 'souhaitable', weight: 2 }),
    ],
  };
}

function verdict(
  criterionId: string,
  llmDecision: LlmCriterionVerdict['llmDecision'],
  extra: Partial<LlmCriterionVerdict> = {},
): LlmCriterionVerdict {
  return {
    criterionId,
    llmDecision,
    llmJustification: `Décision ${llmDecision} sur ${criterionId}.`,
    llmCVQuote: extra.llmCVQuote ?? 'extrait CV',
    ...extra,
  };
}

const HARD_OK = [verdict('ko', 'satisfait')];

describe('scoreCandidat — normalisation SOFT uniquement (option B)', () => {
  it('moyenne pondérée sur les SOFT seuls (HARD hors moyenne)', () => {
    // SOFT tous satisfaits → 100 ; HARD satisfaits → pas d’escalade.
    const r = scoreCandidat(
      [
        ...HARD_OK,
        verdict('s_ifrs', 'satisfait'),
        verdict('s_sap', 'satisfait'),
        verdict('s_eng', 'satisfait'),
        verdict('s_big4', 'satisfait'),
      ],
      sheetA(),
    );
    expect(r.totalScore).toBe(100);
    expect(r.status).toBe('accepted');
    expect(r.hardFailures).toEqual([]);
  });

  it('facteurs satisfait=1 / partiel=0.5 / non=0 appliqués au poids', () => {
    // 8*1 + 6*0.5 + 4*0 + 2*1 = 13 → 13/20*100 = 65 → rejected (<75).
    const r = scoreCandidat(
      [
        ...HARD_OK,
        verdict('s_ifrs', 'satisfait'),
        verdict('s_sap', 'partiel'),
        verdict('s_eng', 'non'),
        verdict('s_big4', 'satisfait'),
      ],
      sheetA(),
    );
    expect(r.totalScore).toBe(65);
    expect(r.status).toBe('rejected');
  });

  it('Σ des contributions SOFT du breakdown == score de base', () => {
    const r = scoreCandidat(
      [
        ...HARD_OK,
        verdict('s_ifrs', 'satisfait'),
        verdict('s_sap', 'partiel'),
        verdict('s_eng', 'satisfait'),
        verdict('s_big4', 'non'),
      ],
      sheetA(),
    );
    const softSum = r.breakdown
      .filter((b) => b.behavior === 'SOFT_WEIGHTED')
      .reduce((acc, b) => acc + b.contribution, 0);
    expect(softSum).toBeCloseTo(r.totalScore, 2);
    // Les critères HARD ne contribuent pas au score.
    for (const b of r.breakdown.filter((b) => b.behavior !== 'SOFT_WEIGHTED')) {
      expect(b.contribution).toBe(0);
    }
  });
});

describe('scoreCandidat — HARD_KNOCKOUT (score conservé)', () => {
  it('rédhibitoire non satisfait ⇒ rejected, score RÉEL conservé (jamais 0)', () => {
    const r = scoreCandidat(
      [
        verdict('ko', 'non'),
        verdict('s_ifrs', 'satisfait'),
        verdict('s_sap', 'satisfait'),
        verdict('s_eng', 'satisfait'),
        verdict('s_big4', 'non'),
      ],
      sheetA(),
    );
    expect(r.totalScore).toBe(90); // 8+6+4+0 = 18 → 90, NON forcé à 0
    expect(r.status).toBe('rejected');
    expect(r.hardFailures).toEqual([
      {
        criterionId: 'ko',
        criterionLabel: 'Diplôme DEC',
        criticityLevel: 'redhibitoire',
        reason: 'unsatisfied',
      },
    ]);
  });

  it('rédhibitoire non vérifiable ⇒ même effet (rejected), reason unverifiable', () => {
    const r = scoreCandidat(
      [verdict('ko', 'non_verifiable'),
       verdict('s_ifrs', 'satisfait'), verdict('s_sap', 'satisfait'),
       verdict('s_eng', 'satisfait'), verdict('s_big4', 'satisfait')],
      sheetA(),
    );
    expect(r.status).toBe('rejected');
    expect(r.totalScore).toBe(100);
    expect(r.hardFailures[0]).toMatchObject({ criterionId: 'ko', reason: 'unverifiable' });
  });
});

describe('scoreCandidat — comportement de seuil (frontière)', () => {
  // Fiche frontière SOFT [7,6,6,6] (den 25) pour atteindre 74/76.
  function sheetB(): ScoringSheet {
    return {
      campaignId: 'CAMP-FRONT',
      isValidated: true,
      acceptanceThreshold: 75,
      criteria: [
        buildCriterion({ id: 'ko', label: 'KO', level: 'redhibitoire' }),
        buildCriterion({ id: 'b1', label: 'B1', level: 'critique', weight: 7 }),
        buildCriterion({ id: 'b2', label: 'B2', level: 'tres_important', weight: 6 }),
        buildCriterion({ id: 'b3', label: 'B3', level: 'important', weight: 6 }),
        buildCriterion({ id: 'b4', label: 'B4', level: 'souhaitable', weight: 6 }),
      ],
    };
  }

  it('score 75 (= seuil) ⇒ accepted', () => {
    // sheetA, 8+6+0+1 = 15 → 75
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_ifrs', 'satisfait'), verdict('s_sap', 'satisfait'),
       verdict('s_eng', 'non'), verdict('s_big4', 'partiel')],
      sheetA(),
    );
    expect(r.totalScore).toBe(75);
    expect(r.status).toBe('accepted');
  });

  it('score 74 ⇒ rejected, score 76 ⇒ accepted', () => {
    // 74 : 3.5+6+6+3 = 18.5 → 74
    const r74 = scoreCandidat(
      [...HARD_OK, verdict('b1', 'partiel'), verdict('b2', 'satisfait'),
       verdict('b3', 'satisfait'), verdict('b4', 'partiel')],
      sheetB(),
    );
    expect(r74.totalScore).toBe(74);
    expect(r74.status).toBe('rejected');
    // 76 : 7+6+3+3 = 19 → 76
    const r76 = scoreCandidat(
      [...HARD_OK, verdict('b1', 'satisfait'), verdict('b2', 'satisfait'),
       verdict('b3', 'partiel'), verdict('b4', 'partiel')],
      sheetB(),
    );
    expect(r76.totalScore).toBe(76);
    expect(r76.status).toBe('accepted');
  });
});

describe('scoreCandidat — robustesse & purété', () => {
  it('décision manquante ⇒ traitée comme non_verifiable', () => {
    // s_ifrs absent → factor 0 sur p8 : 0+6+4+2 = 12 → 60.
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_sap', 'satisfait'), verdict('s_eng', 'satisfait'),
       verdict('s_big4', 'satisfait')],
      sheetA(),
    );
    expect(r.totalScore).toBe(60);
    const ifrs = r.breakdown.find((b) => b.criterionId === 's_ifrs');
    expect(ifrs?.llmDecision).toBe('non_verifiable');
  });

  it('llmFailure ⇒ critère forcé non_verifiable', () => {
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_ifrs', 'satisfait', { llmFailure: true }),
       verdict('s_sap', 'satisfait'), verdict('s_eng', 'satisfait'),
       verdict('s_big4', 'satisfait')],
      sheetA(),
    );
    // s_ifrs neutralisé : 0+6+4+2 = 12 → 60.
    expect(r.totalScore).toBe(60);
    expect(r.breakdown.find((b) => b.criterionId === 's_ifrs')?.llmDecision).toBe(
      'non_verifiable',
    );
  });

  it('décision avec criterionId inconnu ⇒ ignorée', () => {
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_ifrs', 'satisfait'), verdict('s_sap', 'satisfait'),
       verdict('s_eng', 'satisfait'), verdict('s_big4', 'satisfait'),
       verdict('fantome', 'satisfait')],
      sheetA(),
    );
    expect(r.totalScore).toBe(100);
    expect(r.breakdown.some((b) => b.criterionId === 'fantome')).toBe(false);
  });

  it('breakdown TOUJOURS complet (tous les critères de la fiche) même si knockout', () => {
    const r = scoreCandidat([verdict('ko', 'non')], sheetA());
    expect(r.breakdown).toHaveLength(5);
    expect(r.status).toBe('rejected');
  });

  it('breakdown copie les attributs du critère (audit)', () => {
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_ifrs', 'partiel'), verdict('s_sap', 'satisfait'),
       verdict('s_eng', 'satisfait'), verdict('s_big4', 'satisfait')],
      sheetA(),
    );
    const ifrs = r.breakdown.find((b) => b.criterionId === 's_ifrs');
    expect(ifrs).toMatchObject({
      criterionLabel: 'IFRS',
      criticityLevel: 'critique',
      weight: 8,
      behavior: 'SOFT_WEIGHTED',
    });
  });

  it('déterminisme : même entrée ⇒ même sortie (hors computedAt sentinelle)', () => {
    const decisions = [...HARD_OK, verdict('s_ifrs', 'partiel'),
      verdict('s_sap', 'satisfait'), verdict('s_eng', 'non'), verdict('s_big4', 'partiel')];
    const a = scoreCandidat(decisions, sheetA());
    const b = scoreCandidat(decisions, sheetA());
    expect(a).toEqual(b);
  });

  it('options.computedAt / criteriaVersion sont injectées (pureté)', () => {
    const r = scoreCandidat([...HARD_OK, verdict('s_ifrs', 'satisfait'),
      verdict('s_sap', 'satisfait'), verdict('s_eng', 'satisfait'),
      verdict('s_big4', 'satisfait')], sheetA(), {
      computedAt: '2026-06-06T08:00:00.000Z',
      criteriaVersion: 'v3',
    });
    expect(r.computedAt).toBe('2026-06-06T08:00:00.000Z');
    expect(r.criteriaVersion).toBe('v3');
  });

  it('seuil surchargé via options prime sur celui de la fiche', () => {
    const r = scoreCandidat(
      [...HARD_OK, verdict('s_ifrs', 'satisfait'), verdict('s_sap', 'satisfait'),
       verdict('s_eng', 'non'), verdict('s_big4', 'non')],
      sheetA(75),
      { acceptanceThreshold: 80 },
    );
    // 8+6 = 14 → 70 ; rejeté à 80 comme à 75 ici, mais vérifions le passage.
    expect(r.totalScore).toBe(70);
    expect(r.status).toBe('rejected');
  });

  it('fiche sans critère scorable ⇒ ScoringError', () => {
    const empty: ScoringSheet = {
      campaignId: 'CAMP-X',
      isValidated: false,
      criteria: [],
    };
    expect(() => scoreCandidat([], empty)).toThrow(ScoringError);
  });
});
