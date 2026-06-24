import { describe, expect, it } from 'vitest';

import { formatDateTimeFr } from '@/lib/format/datetime';

describe('formatDateTimeFr', () => {
  it('formate une date valide en jj/mm/aaaa hh:mm (FR)', () => {
    const out = formatDateTimeFr('2026-06-23T12:30:00.000Z');
    // Robuste au fuseau du runner : on vérifie la FORME, pas l'heure exacte.
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/);
    expect(out).toContain('2026');
  });

  it('renvoie « — » pour une entrée absente ou invalide', () => {
    expect(formatDateTimeFr(null)).toBe('—');
    expect(formatDateTimeFr(undefined)).toBe('—');
    expect(formatDateTimeFr('')).toBe('—');
    expect(formatDateTimeFr('pas une date')).toBe('—');
  });
});
