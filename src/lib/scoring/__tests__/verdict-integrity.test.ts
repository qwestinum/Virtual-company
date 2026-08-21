/**
 * « Un non sans preuve n'est pas un verdict » — l'invariant, isolé.
 *
 * Incident du 21/08/2026 (CAMP-2026-288) : quatre critères refusés à un
 * candidat sans qu'aucun modèle n'ouvre son CV. Le pré-filtre par mots-clés,
 * conçu comme un accélérateur, s'était mis à juger.
 */
import { describe, expect, it } from 'vitest';

import {
  UnprovenNegativeVerdictError,
  assertNoUnprovenNegative,
  findUnprovenNegatives,
  isDecisiveNegative,
} from '@/lib/scoring/verdict-integrity';

describe('isDecisiveNegative', () => {
  it('seul « non » affirme quelque chose CONTRE le candidat', () => {
    expect(isDecisiveNegative('non')).toBe(true);
    // « non_verifiable » est le marqueur honnête de « non évalué » : il
    // n'affirme rien, et n'a donc rien à prouver.
    expect(isDecisiveNegative('non_verifiable')).toBe(false);
    expect(isDecisiveNegative('partiel')).toBe(false);
    expect(isDecisiveNegative('satisfait')).toBe(false);
  });
});

describe('findUnprovenNegatives', () => {
  it('repère un « non » rendu par un chemin qui n’a pas lu le CV', () => {
    const found = findUnprovenNegatives([
      { criterionId: 'moa', llmDecision: 'non', decidedBy: 'keyword_match' },
    ]);
    expect(found.map((v) => v.criterionId)).toEqual(['moa']);
  });

  it('un « non » du MODÈLE est légitime : il a lu', () => {
    expect(
      findUnprovenNegatives([
        { criterionId: 'moa', llmDecision: 'non', decidedBy: 'llm' },
      ]),
    ).toEqual([]);
  });

  it('un « satisfait » par mot-clé reste légitime — l’économie d’appel est gardée', () => {
    expect(
      findUnprovenNegatives([
        { criterionId: 'react', llmDecision: 'satisfait', decidedBy: 'keyword_match' },
      ]),
    ).toEqual([]);
  });

  it('« non_verifiable » sans lecture passe : il ne conclut pas contre le candidat', () => {
    expect(
      findUnprovenNegatives([
        { criterionId: 'x', llmDecision: 'non_verifiable', decidedBy: 'keyword_match' },
      ]),
    ).toEqual([]);
  });

  it('chemin INCONNU (analyses antérieures au champ) : hors du champ de la règle', () => {
    // On ne relit pas l'historique à l'aune d'une règle qu'il ne pouvait pas
    // connaître ; le repérage du parc existant se fait sur la trace de l'époque.
    expect(
      findUnprovenNegatives([{ criterionId: 'vieux', llmDecision: 'non' }]),
    ).toEqual([]);
  });
});

describe('assertNoUnprovenNegative', () => {
  it('LÈVE plutôt que de corriger en silence, en nommant les critères', () => {
    expect(() =>
      assertNoUnprovenNegative([
        { criterionId: 'moa', llmDecision: 'non', decidedBy: 'keyword_match' },
        { criterionId: 'finance', llmDecision: 'non', decidedBy: 'keyword_match' },
        { criterionId: 'react', llmDecision: 'satisfait', decidedBy: 'keyword_match' },
      ]),
    ).toThrow(UnprovenNegativeVerdictError);

    try {
      assertNoUnprovenNegative([
        { criterionId: 'moa', llmDecision: 'non', decidedBy: 'keyword_match' },
      ]);
    } catch (err) {
      expect((err as UnprovenNegativeVerdictError).criterionIds).toEqual(['moa']);
      expect((err as Error).message).toContain('moa');
    }
  });

  it('ne dit rien sur un lot conforme', () => {
    expect(() =>
      assertNoUnprovenNegative([
        { criterionId: 'react', llmDecision: 'satisfait', decidedBy: 'keyword_match' },
        { criterionId: 'moa', llmDecision: 'non', decidedBy: 'llm' },
      ]),
    ).not.toThrow();
  });
});
