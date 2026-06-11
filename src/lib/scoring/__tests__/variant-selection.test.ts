import { describe, expect, it } from 'vitest';

import { dedupeVariants, toggleVariant } from '@/lib/scoring/variant-selection';

describe('dedupeVariants', () => {
  it('dédup vs existant (insensible casse) + inter-variantes, trim, retire vides', () => {
    expect(
      dedupeVariants(
        ['  Django ', 'django', 'Flask', 'Python', '', 'FastAPI'],
        ['python'],
      ),
    ).toEqual(['Django', 'Flask', 'FastAPI']);
  });

  it('cap à 15 par défaut', () => {
    const many = Array.from({ length: 30 }, (_, i) => `v${i}`);
    expect(dedupeVariants(many, [])).toHaveLength(15);
  });

  it('préserve casse et ordre des propositions', () => {
    expect(dedupeVariants(['JS', 'Node.js'], ['JavaScript'])).toEqual(['JS', 'Node.js']);
  });
});

describe('toggleVariant', () => {
  it('ajoute si absent, retire si présent', () => {
    expect(toggleVariant(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleVariant(['a', 'b'], 'a')).toEqual(['b']);
  });
});
