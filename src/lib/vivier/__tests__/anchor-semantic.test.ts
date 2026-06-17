import { describe, expect, it } from 'vitest';

import { pickBestAnchor } from '@/lib/vivier/anchor-semantic';

const W = [1, 0.95, 0.9];

describe('pickBestAnchor', () => {
  it('repêche via un POSTE quand le titre déclaré est sous le seuil', () => {
    // depth 0 (déclaré bruité) 0.43 < floor ; depth 1 (poste propre) 0.70 ≥ floor.
    const m = pickBestAnchor(
      [{ depth: 0, similarity: 0.43 }, { depth: 1, similarity: 0.7 }],
      W,
      0.55,
    );
    expect(m).not.toBeNull();
    expect(m!.depth).toBe(1);
    expect(m!.rawSimilarity).toBeCloseTo(0.7);
    // Score décoté = 0.70 × 0.95.
    expect(m!.similarity).toBeCloseTo(0.665);
  });

  it('aucune ancre ≥ floor ⇒ null (non qualifié)', () => {
    expect(
      pickBestAnchor([{ depth: 0, similarity: 0.4 }, { depth: 1, similarity: 0.5 }], W, 0.55),
    ).toBeNull();
  });

  it('porte sur le BRUT, score sur le DÉCOTÉ : un brut élevé en profondeur peut gagner', () => {
    // depth 0 brut 0.60 → décoté 0.60 ; depth 1 brut 0.66 → décoté 0.627.
    const m = pickBestAnchor(
      [{ depth: 0, similarity: 0.6 }, { depth: 1, similarity: 0.66 }],
      W,
      0.55,
    );
    expect(m!.depth).toBe(1); // 0.627 > 0.60
  });

  it('décote départage en faveur du rôle COURANT à brut égal', () => {
    const m = pickBestAnchor(
      [{ depth: 0, similarity: 0.7 }, { depth: 2, similarity: 0.7 }],
      W,
      0.55,
    );
    expect(m!.depth).toBe(0); // 0.70 > 0.70×0.9
  });

  it('liste vide ⇒ null', () => {
    expect(pickBestAnchor([], W, 0.55)).toBeNull();
  });
});
