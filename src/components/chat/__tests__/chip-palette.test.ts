import { describe, expect, it } from 'vitest';

import {
  CHIP_PALETTE,
  chipPaletteByIndex,
} from '@/components/chat/chip-palette';

describe('chipPaletteByIndex', () => {
  it('returns the first entry for index 0', () => {
    expect(chipPaletteByIndex(0)).toBe(CHIP_PALETTE[0]);
  });

  it('cycles back to the first entry when index >= palette length', () => {
    expect(chipPaletteByIndex(CHIP_PALETTE.length)).toBe(CHIP_PALETTE[0]);
  });

  it('returns distinct entries for the first N indices (N = palette length)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < CHIP_PALETTE.length; i++) {
      seen.add(chipPaletteByIndex(i).bg);
    }
    expect(seen.size).toBe(CHIP_PALETTE.length);
  });

  it('falls back to the first entry on negative or non-finite indices', () => {
    expect(chipPaletteByIndex(-1)).toBe(CHIP_PALETTE[0]);
    expect(chipPaletteByIndex(Number.NaN)).toBe(CHIP_PALETTE[0]);
    expect(chipPaletteByIndex(Number.POSITIVE_INFINITY)).toBe(CHIP_PALETTE[0]);
  });

  it('every palette entry exposes the four class slots', () => {
    for (const entry of CHIP_PALETTE) {
      expect(entry.bg).toMatch(/^bg-/);
      expect(entry.text).toMatch(/^text-/);
      expect(entry.border).toMatch(/^border-/);
      expect(entry.hover).toContain('hover:');
    }
  });
});
