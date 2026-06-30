import { describe, expect, it } from 'vitest';

import { formatSmartDate, initials } from '@/components/candidatures/stage-ui';

// Dates construites en composantes LOCALES (round-trip ISO) → déterministe quel
// que soit le fuseau du runner. `now` = 30 juin 2026, 18:00 local.
const NOW = new Date(2026, 5, 30, 18, 0, 0);
const iso = (y: number, m: number, d: number, h = 9, min = 0): string =>
  new Date(y, m, d, h, min, 0).toISOString();

describe('formatSmartDate', () => {
  it("aujourd'hui → heure à la minute (séparateur h)", () => {
    expect(formatSmartDate(iso(2026, 5, 30, 15, 33), NOW)).toBe(
      "aujourd'hui à 15h33",
    );
  });

  it('hier → minutes zéro-paddées', () => {
    expect(formatSmartDate(iso(2026, 5, 29, 10, 2), NOW)).toBe('hier à 10h02');
  });

  it('2–6 jours → « il y a N jours »', () => {
    expect(formatSmartDate(iso(2026, 5, 27), NOW)).toBe('il y a 3 jours');
  });

  it('1 semaine', () => {
    expect(formatSmartDate(iso(2026, 5, 22), NOW)).toBe('il y a 1 semaine');
  });

  it('plusieurs semaines (pluriel)', () => {
    expect(formatSmartDate(iso(2026, 5, 9), NOW)).toBe('il y a 3 semaines');
  });

  it('au-delà de ~2 mois → date absolue', () => {
    const old = iso(2026, 0, 15);
    expect(formatSmartDate(old, NOW)).toBe(
      new Date(2026, 0, 15, 9, 0, 0).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  });

  it('date invalide → tiret', () => {
    expect(formatSmartDate('pas-une-date', NOW)).toBe('—');
  });
});

describe('initials', () => {
  it('prend les 2 premières initiales en majuscules', () => {
    expect(initials('Karim Benali')).toBe('KB');
    expect(initials('sophie marchand')).toBe('SM');
    expect(initials('Cher')).toBe('C');
  });
});
