/**
 * Sous-onglet « Propositions de refus » — logique PURE.
 *
 * Ce qui est vraiment sous test : la partition se lit sur la ZONE FIGÉE AU
 * SCORING, et « À examiner » ne perd rien.
 *
 * Le défaut de référence (18/08/2026) : la partition comparait le score au
 * seuil bas COURANT de la campagne. Un dossier analysé en zone grise basculait
 * donc dans les propositions de refus dès qu'on déplaçait le seuil — re-jugé
 * avec un barème qu'il n'avait jamais connu. Le premier test ci-dessous est
 * exactement ce cas.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultValidationSubTab,
  isRejectionProposal,
  partitionRejectionProposals,
  sortRejectionProposals,
} from '@/lib/hitl/rejection-proposal';
import type { DecisionZone } from '@/types/hitl';

type V = { id: string; score: number | null; decision: 'accept' | 'reject' };

const v = (
  id: string,
  score: number | null,
  decision: 'accept' | 'reject' = 'reject',
): V => ({ id, score, decision });

describe('isRejectionProposal', () => {
  it('seule la zone `proposed_reject` est une proposition', () => {
    expect(isRejectionProposal('proposed_reject')).toBe(true);
    expect(isRejectionProposal('gray')).toBe(false);
    expect(isRejectionProposal('auto_accept')).toBe(false);
  });

  it('`auto_reject` (LEGACY) n’est PAS une proposition', () => {
    // Sous l'ancien régime ces refus partaient seuls, sans passer par la file :
    // une ligne de file qui la porte est une anomalie, pas une proposition.
    expect(isRejectionProposal('auto_reject')).toBe(false);
  });

  it('zone inconnue ⇒ jamais proposée (repli sûr : reste à examiner)', () => {
    expect(isRejectionProposal(null)).toBe(false);
    expect(isRejectionProposal(undefined)).toBe(false);
  });
});

describe('partitionRejectionProposals', () => {
  it('un GRIS reste « à examiner » quel que soit son score (zone figée)', () => {
    // Bahati : analysé en zone grise à 80, seuil bas déplacé à 93 depuis.
    // Comparer au seuil courant le classerait « proposé au refus » — c'est
    // précisément ce qu'on interdit ici.
    const items = [v('bahati', 80)];
    const { proposals, toExamine } = partitionRejectionProposals(items, {
      bahati: 'gray',
    });
    expect(proposals).toEqual([]);
    expect(toExamine.map((x) => x.id)).toEqual(['bahati']);
  });

  it('partition STRICTE : chaque validation est dans exactement une liste', () => {
    const items = [v('a', 10), v('b', 50), v('c', null), v('d', 39)];
    const zones: Record<string, DecisionZone | null> = {
      a: 'proposed_reject',
      b: 'gray',
      c: null,
      d: 'proposed_reject',
    };
    const { proposals, toExamine } = partitionRejectionProposals(items, zones);
    expect(proposals.map((x) => x.id)).toEqual(['a', 'd']);
    expect(toExamine.map((x) => x.id)).toEqual(['b', 'c']);
    expect(proposals.length + toExamine.length).toBe(items.length);
  });

  it('une analyse introuvable ne perd AUCUNE validation', () => {
    const items = [v('a', 1), v('b', 2)];
    const { proposals, toExamine } = partitionRejectionProposals(items, {});
    expect(proposals).toEqual([]);
    expect(toExamine.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('une acceptation en attente n’est JAMAIS proposée au refus', () => {
    const items = [v('a', 5, 'accept')];
    const { proposals, toExamine } = partitionRejectionProposals(items, {
      a: 'proposed_reject',
    });
    expect(proposals).toEqual([]);
    expect(toExamine.map((x) => x.id)).toEqual(['a']);
  });
});

describe('sortRejectionProposals', () => {
  it('score DÉCROISSANT — les cas limites en tête', () => {
    const sorted = sortRejectionProposals([v('a', 10), v('b', 38), v('c', 25)]);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('départage stable par id à score égal', () => {
    const sorted = sortRejectionProposals([v('b', 20), v('a', 20)]);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('ne mute pas l’entrée', () => {
    const input = [v('a', 10), v('b', 38)];
    sortRejectionProposals(input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

// ── Sous-onglet d'arrivée ───────────────────────────────────────────────────

describe('defaultValidationSubTab', () => {
  it('ouvre sur « Propositions de refus » quand c’est le seul sous-onglet peuplé', () => {
    // Le cas mesuré en recette : badge d'onglet à 2, « À examiner » à 0.
    expect(defaultValidationSubTab(0, 2)).toBe('proposals');
  });

  it('garde « À examiner » dès qu’il a quelque chose', () => {
    expect(defaultValidationSubTab(3, 0)).toBe('examine');
    expect(defaultValidationSubTab(3, 7)).toBe('examine');
    expect(defaultValidationSubTab(1, 200)).toBe('examine');
  });

  it('file entièrement vide → « À examiner », dont l’état vide est le plus juste', () => {
    expect(defaultValidationSubTab(0, 0)).toBe('examine');
  });

  it('n’ouvre JAMAIS sur un sous-onglet vide quand l’autre est peuplé', () => {
    for (const [examine, proposals] of [
      [0, 1],
      [0, 14],
      [5, 0],
      [1, 0],
    ] as const) {
      const onglet = defaultValidationSubTab(examine, proposals);
      const peuplé = onglet === 'examine' ? examine : proposals;
      expect(peuplé).toBeGreaterThan(0);
    }
  });
});
