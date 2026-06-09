import { describe, expect, it } from 'vitest';

import {
  PERIOD_PRESETS,
  presetsByKeys,
  type PeriodPresetKey,
} from '@/lib/reporting/period-presets';

function rangeOf(key: PeriodPresetKey, ref: Date) {
  const p = PERIOD_PRESETS.find((x) => x.key === key)!;
  return p.range(ref);
}

// Référence : mercredi 10 juin 2026 (mois 5 = juin, T2). Date locale fixe.
const REF = new Date(2026, 5, 10);

describe('PERIOD_PRESETS', () => {
  it('cette semaine = lundi → dimanche (semaine FR)', () => {
    // 10 juin 2026 = mercredi → lundi 8, dimanche 14.
    expect(rangeOf('this_week', REF)).toEqual({
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });

  it('semaine précédente', () => {
    expect(rangeOf('last_week', REF)).toEqual({
      from: '2026-06-01',
      to: '2026-06-07',
    });
  });

  it('ce mois = 1er → dernier jour du mois', () => {
    expect(rangeOf('this_month', REF)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('mois précédent (mai, 31 jours)', () => {
    expect(rangeOf('last_month', REF)).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
  });

  it('ce trimestre (T2 = avril→juin)', () => {
    expect(rangeOf('this_quarter', REF)).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
  });

  it('trimestre précédent (T1 = janvier→mars)', () => {
    expect(rangeOf('last_quarter', REF)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('cette année / année précédente', () => {
    expect(rangeOf('this_year', REF)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(rangeOf('last_year', REF)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('trimestre précédent en T1 bascule sur l’année antérieure', () => {
    // 15 février 2026 (T1) → T précédent = T4 2025.
    expect(rangeOf('last_quarter', new Date(2026, 1, 15))).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    });
  });

  it('presetsByKeys filtre et préserve l’ordre demandé', () => {
    const got = presetsByKeys(['this_year', 'this_week']).map((p) => p.key);
    expect(got).toEqual(['this_year', 'this_week']);
  });
});
