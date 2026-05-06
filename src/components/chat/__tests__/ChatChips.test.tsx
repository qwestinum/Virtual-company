import { describe, expect, it } from 'vitest';

import { placementContainerClass } from '@/components/chat/ChatChips';
import {
  ChipPlacementSchema,
  type ChipPlacement,
} from '@/types/manager-response';

describe('ChatChips placement mapping', () => {
  it('returns a non-empty class for every canonical placement', () => {
    for (const placement of ChipPlacementSchema.options) {
      const cls = placementContainerClass(placement);
      expect(typeof cls).toBe('string');
      expect(cls.length).toBeGreaterThan(0);
    }
  });

  it('returns distinct classes per placement (no accidental aliasing)', () => {
    const classes = new Set(
      ChipPlacementSchema.options.map((p) => placementContainerClass(p)),
    );
    expect(classes.size).toBe(ChipPlacementSchema.options.length);
  });

  it('below_bubble layout is offset to align under the manager bubble', () => {
    expect(placementContainerClass('below_bubble' as ChipPlacement)).toContain(
      'ml-10',
    );
  });

  it('above_input layout has a top border to separate it from the chat scroll', () => {
    expect(placementContainerClass('above_input' as ChipPlacement)).toContain(
      'border-t',
    );
  });

  it('inline layout stays compact for in-bubble rendering', () => {
    const cls = placementContainerClass('inline' as ChipPlacement);
    expect(cls).not.toContain('border-t');
    expect(cls).not.toContain('ml-10');
  });
});
