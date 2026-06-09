/**
 * Presets de période — brique mutualisée des filtres Reporting (chips
 * raccourcis, cf. docs/specs/reporting.md §3.2 et §4.2).
 *
 * PUR & client-safe : chaque preset calcule une plage `{ from, to }` en
 * dates ISO (YYYY-MM-DD) à partir d'une date de RÉFÉRENCE passée en
 * argument — jamais `new Date()` implicite, pour rester déterministe et
 * testable. La semaine démarre LUNDI (convention FR).
 */

export type PeriodRange = { from: string; to: string };

export type PeriodPresetKey =
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year';

export type PeriodPreset = {
  key: PeriodPresetKey;
  label: string;
  /** @param ref Date de référence (« aujourd'hui »). */
  range: (ref: Date) => PeriodRange;
};

/** Formatte une date locale en YYYY-MM-DD (sans décalage UTC). */
function toIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lundi de la semaine de `ref` (00:00 local). */
function startOfWeek(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - dow);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function range(from: Date, to: Date): PeriodRange {
  return { from: toIsoDay(from), to: toIsoDay(to) };
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  {
    key: 'this_week',
    label: 'Cette semaine',
    range: (ref) => {
      const start = startOfWeek(ref);
      return range(start, addDays(start, 6));
    },
  },
  {
    key: 'last_week',
    label: 'Semaine précédente',
    range: (ref) => {
      const start = addDays(startOfWeek(ref), -7);
      return range(start, addDays(start, 6));
    },
  },
  {
    key: 'this_month',
    label: 'Ce mois',
    range: (ref) =>
      range(
        new Date(ref.getFullYear(), ref.getMonth(), 1),
        new Date(ref.getFullYear(), ref.getMonth() + 1, 0),
      ),
  },
  {
    key: 'last_month',
    label: 'Mois précédent',
    range: (ref) =>
      range(
        new Date(ref.getFullYear(), ref.getMonth() - 1, 1),
        new Date(ref.getFullYear(), ref.getMonth(), 0),
      ),
  },
  {
    key: 'this_quarter',
    label: 'Ce trimestre',
    range: (ref) => {
      const q = Math.floor(ref.getMonth() / 3);
      return range(
        new Date(ref.getFullYear(), q * 3, 1),
        new Date(ref.getFullYear(), q * 3 + 3, 0),
      );
    },
  },
  {
    key: 'last_quarter',
    label: 'Trimestre précédent',
    range: (ref) => {
      const q = Math.floor(ref.getMonth() / 3) - 1;
      return range(
        new Date(ref.getFullYear(), q * 3, 1),
        new Date(ref.getFullYear(), q * 3 + 3, 0),
      );
    },
  },
  {
    key: 'this_year',
    label: 'Cette année',
    range: (ref) =>
      range(
        new Date(ref.getFullYear(), 0, 1),
        new Date(ref.getFullYear(), 11, 31),
      ),
  },
  {
    key: 'last_year',
    label: 'Année précédente',
    range: (ref) =>
      range(
        new Date(ref.getFullYear() - 1, 0, 1),
        new Date(ref.getFullYear() - 1, 11, 31),
      ),
  },
];

/** Sous-ensemble par défaut pour l'audit candidat (filtre période simple). */
export const AUDIT_PERIOD_PRESET_KEYS: PeriodPresetKey[] = [
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
];

export function presetsByKeys(keys: PeriodPresetKey[]): PeriodPreset[] {
  return keys
    .map((k) => PERIOD_PRESETS.find((p) => p.key === k))
    .filter((p): p is PeriodPreset => p !== undefined);
}
