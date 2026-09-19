import { describe, expect, it } from 'vitest';

import type { ValidationDecisionState } from '@/lib/candidatures/decision-markers';
import {
  countMotivatedDecisions,
  resolveFinalDecisionView,
} from '@/lib/candidatures/final-decision';
import type { VerdictComment } from '@/types/verdict-comment';

const comment = (id: string, verdict: 'validated' | 'rejected', createdAt: string): VerdictComment => ({
  id,
  analysisId: 'can_1',
  uid: 'u1',
  campaignId: 'CAMP-2026-001',
  verdict,
  body: `Motif ${id}`,
  authorUserId: 'u-sarah',
  authorEmail: 'sarah@cabinet.fr',
  createdAt,
});
const state = (over: Partial<ValidationDecisionState>): ValidationDecisionState => ({
  effect: 'validated',
  at: '2026-09-10T10:00:00.000Z',
  commentId: null,
  ...over,
});

describe('resolveFinalDecisionView', () => {
  it('aucun verdict courant (jamais posé, ou gommé) : null', () => {
    expect(resolveFinalDecisionView(state({ effect: null, at: null }), [])).toBeNull();
    expect(resolveFinalDecisionView(state({ effect: null }), [comment('c1', 'validated', 'x')])).toBeNull();
  });

  it('le verdict porte SON commentaire', () => {
    const v = resolveFinalDecisionView(state({ commentId: 'c1' }), [
      comment('c1', 'validated', '2026-09-10T10:00:00.000Z'),
      comment('c2', 'rejected', '2026-09-11T10:00:00.000Z'),
    ]);
    expect(v?.comment?.id).toBe('c1');
    expect(v?.commentMatches).toBe(true);
  });

  it('verdict corrigé sans commentaire : le dernier écrit est montré, AVEC son verdict d’origine', () => {
    const v = resolveFinalDecisionView(state({ effect: 'rejected', commentId: null }), [
      comment('c1', 'validated', '2026-09-10T10:00:00.000Z'),
    ]);
    expect(v?.verdict).toBe('rejected');
    expect(v?.comment?.verdict).toBe('validated');
    expect(v?.commentMatches).toBe(false);
  });

  it('verdict antérieur à la règle : comment null (les lecteurs le DISENT)', () => {
    const v = resolveFinalDecisionView(state({}), []);
    expect(v).toEqual({
      verdict: 'validated',
      decidedAt: '2026-09-10T10:00:00.000Z',
      comment: null,
      commentMatches: false,
    });
  });
});

describe('countMotivatedDecisions', () => {
  it('ne compte que les verdicts COURANTS, motivés = portant leur commentaire', () => {
    expect(
      countMotivatedDecisions([
        state({ commentId: 'c1' }),
        state({ effect: 'rejected', commentId: 'c2' }),
        state({ commentId: null }), // corrigé ou historique
        state({ effect: null, commentId: null }), // gommé
      ]),
    ).toEqual({ total: 3, motivated: 2 });
  });
});
