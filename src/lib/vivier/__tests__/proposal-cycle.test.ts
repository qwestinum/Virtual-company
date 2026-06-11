import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  decisionTargetState,
  ProposalTransitionError,
} from '@/lib/vivier/proposal-cycle';

describe('proposal-cycle — cycle factuel (3 états, pas de spéculatif)', () => {
  it('decisionTargetState : accepter → contacted, rejeter → rejected', () => {
    expect(decisionTargetState('accept')).toBe('contacted');
    expect(decisionTargetState('reject')).toBe('rejected');
  });

  it('seules les transitions depuis identified sont autorisées', () => {
    expect(canTransition('identified', 'contacted')).toBe(true);
    expect(canTransition('identified', 'rejected')).toBe(true);
  });

  it('aucune transition spéculative ni retour en arrière', () => {
    // Terminal : un fait acté ne se défait pas, ne se requalifie pas.
    expect(canTransition('contacted', 'rejected')).toBe(false);
    expect(canTransition('rejected', 'contacted')).toBe(false);
    expect(canTransition('contacted', 'identified')).toBe(false);
    expect(canTransition('rejected', 'identified')).toBe(false);
    expect(canTransition('identified', 'identified')).toBe(false);
  });

  it('assertTransition lève ProposalTransitionError sur transition interdite', () => {
    expect(() => assertTransition('identified', 'contacted')).not.toThrow();
    expect(() => assertTransition('contacted', 'rejected')).toThrow(
      ProposalTransitionError,
    );
  });
});
