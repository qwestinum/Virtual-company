/**
 * Le verdict et le commentaire qui le motive, pliés ensemble.
 * Spec : docs/specs/compte-rendu-entretien.md §2.3, §4.3.
 */
import { describe, expect, it } from 'vitest';

import {
  buildValidationMarkerEntry,
  emptyValidationDecisionState,
  emptyValidationState,
  foldValidationDecision,
  foldValidationMark,
  readValidationCommentId,
} from '@/lib/candidatures/decision-markers';

const T0 = '2026-09-18T09:00:00.000Z';
const T1 = '2026-09-18T10:00:00.000Z';
const T2 = '2026-09-18T11:00:00.000Z';

const verdict = (value: 'validated' | 'rejected' | 'cleared', commentId?: string, corrected?: boolean) =>
  buildValidationMarkerEntry({
    uid: 'u1',
    candidateName: 'Témoin',
    campaignId: 'CAMP-2026-001',
    value,
    commentId,
    corrected,
  }).payload;

describe('écriture — l’identifiant, jamais le texte', () => {
  it('le marqueur porte commentId quand il est fourni', () => {
    expect(verdict('validated', 'c-1')).toEqual({
      uid: 'u1',
      candidate: 'Témoin',
      status: 'validated',
      commentId: 'c-1',
    });
  });

  it('sans commentaire, le payload est celui d’avant (aucune clé vide)', () => {
    expect(verdict('rejected')).toEqual({ uid: 'u1', candidate: 'Témoin', status: 'rejected' });
  });

  it('le type n’offre aucun champ où déposer le texte du commentaire', () => {
    // Garde structurelle : seules ces clés peuvent sortir du builder.
    const keys = Object.keys(verdict('validated', 'c-1', true)).sort();
    expect(keys).toEqual(['candidate', 'commentId', 'corrected', 'status', 'uid']);
  });
});

describe('lecture défensive', () => {
  it.each([[null], [undefined], [{}], [{ commentId: 42 }], [{ commentId: '  ' }]])(
    'rend null sur %j',
    (payload) => {
      expect(readValidationCommentId(payload as Record<string, unknown> | null | undefined)).toBeNull();
    },
  );
});

describe('pliage — le commentaire suit le marqueur GAGNANT', () => {
  it('verdict motivé', () => {
    const s = foldValidationDecision(emptyValidationDecisionState(), verdict('validated', 'c-1'), T0);
    expect(s).toEqual({ effect: 'validated', at: T0, commentId: 'c-1' });
  });

  it('verdict historique (avant la règle) : effet posé, aucun commentaire', () => {
    const s = foldValidationDecision(emptyValidationDecisionState(), verdict('validated'), T0);
    expect(s).toEqual({ effect: 'validated', at: T0, commentId: null });
  });

  it('une correction ultérieure n’hérite PAS du commentaire du premier verdict', () => {
    let s = foldValidationDecision(emptyValidationDecisionState(), verdict('validated', 'c-1'), T0);
    s = foldValidationDecision(s, verdict('rejected', undefined, true), T1);
    expect(s).toEqual({ effect: 'rejected', at: T1, commentId: null });
  });

  it('la gomme retire le verdict ET son commentaire', () => {
    let s = foldValidationDecision(emptyValidationDecisionState(), verdict('validated', 'c-1'), T0);
    s = foldValidationDecision(s, verdict('cleared', undefined, true), T1);
    expect(s).toEqual({ effect: null, at: T1, commentId: null });
  });

  it('un marqueur ANTÉRIEUR arrivé après ne reprend pas la main (ordre d’itération libre)', () => {
    let s = foldValidationDecision(emptyValidationDecisionState(), verdict('rejected', 'c-2'), T2);
    s = foldValidationDecision(s, verdict('validated', 'c-1'), T0);
    expect(s).toEqual({ effect: 'rejected', at: T2, commentId: 'c-2' });
  });

  it('un payload illisible laisse l’état intact', () => {
    const s0 = foldValidationDecision(emptyValidationDecisionState(), verdict('validated', 'c-1'), T0);
    const s1 = foldValidationDecision(s0, { status: 'peut-être', commentId: 'c-9' }, T1);
    expect(s1).toBe(s0);
  });

  it('même effet et même date que foldValidationMark — un enrichissement, pas une seconde règle', () => {
    const entries: [Record<string, unknown>, string][] = [
      [verdict('validated', 'c-1'), T1],
      [verdict('rejected', undefined, true), T2],
      [verdict('cleared'), T0],
    ];
    let a = emptyValidationState();
    let b = emptyValidationDecisionState();
    for (const [p, at] of entries) {
      a = foldValidationMark(a, p, at);
      b = foldValidationDecision(b, p, at);
    }
    expect({ effect: b.effect, at: b.at }).toEqual(a);
  });
});
