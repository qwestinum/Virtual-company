import { describe, it, expect } from 'vitest';

import {
  rejectionCause,
  isKnockout,
  REJECTION_CAUSE_LABELS,
} from '@/lib/scoring';
import type { CriterionFailure, ScoreResult } from '@/types/scoring';

function result(
  status: 'accepted' | 'rejected',
  hardFailures: CriterionFailure[] = [],
): ScoreResult {
  return {
    totalScore: 50,
    status,
    breakdown: [],
    hardFailures,
    criteriaVersion: 'v1',
    computedAt: '2026-06-06T00:00:00.000Z',
  };
}

const KO: CriterionFailure = {
  criterionId: 'ko',
  criterionLabel: 'Diplôme DEC',
  criticityLevel: 'redhibitoire',
  reason: 'unsatisfied',
};
const CAP: CriterionFailure = {
  criterionId: 'cap',
  criterionLabel: '5+ ans',
  criticityLevel: 'obligatoire',
  reason: 'unverifiable',
};

describe('rejectionCause', () => {
  it('accepted ⇒ null', () => {
    expect(rejectionCause(result('accepted'))).toBeNull();
  });

  it('rejected sans échec dur ⇒ below_threshold', () => {
    expect(rejectionCause(result('rejected'))).toBe('below_threshold');
  });

  it('rejected avec cap obligatoire ⇒ cap', () => {
    expect(rejectionCause(result('rejected', [CAP]))).toBe('cap');
  });

  it('rejected avec knockout rédhibitoire ⇒ knockout', () => {
    expect(rejectionCause(result('rejected', [KO]))).toBe('knockout');
  });

  it('précédence : knockout l’emporte sur cap', () => {
    expect(rejectionCause(result('rejected', [CAP, KO]))).toBe('knockout');
    expect(isKnockout(result('rejected', [CAP, KO]))).toBe(true);
  });

  it('libellés des 3 causes', () => {
    expect(REJECTION_CAUSE_LABELS).toEqual({
      knockout: 'knockout',
      cap: 'cap obligatoire',
      below_threshold: 'sous seuil',
    });
  });
});
