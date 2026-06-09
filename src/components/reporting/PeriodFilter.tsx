'use client';

/**
 * Filtre de période — brique mutualisée des sous-onglets Reporting (cf.
 * docs/specs/reporting.md §3.2, §4.2). Deux date pickers (Début / Fin) +
 * chips raccourcis qui remplissent automatiquement les bornes ; l'utilisateur
 * peut ensuite ajuster manuellement.
 *
 * Contrôlé : l'état des bornes vit chez le parent (`from` / `to`, ISO day ou
 * vide). `referenceDate` est injecté pour rester déterministe / testable.
 */

import {
  AUDIT_PERIOD_PRESET_KEYS,
  presetsByKeys,
  type PeriodPresetKey,
} from '@/lib/reporting/period-presets';

export type PeriodFilterProps = {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  /** Presets affichés (défaut = jeu audit candidat). */
  presetKeys?: PeriodPresetKey[];
  /** « Aujourd'hui » de référence pour les presets. */
  referenceDate: Date;
};

export function PeriodFilter({
  from,
  to,
  onChange,
  presetKeys = AUDIT_PERIOD_PRESET_KEYS,
  referenceDate,
}: PeriodFilterProps) {
  const presets = presetsByKeys(presetKeys);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <DateField
          label="Date début"
          value={from}
          onChange={(v) => onChange({ from: v, to })}
        />
        <DateField
          label="Date fin"
          value={to}
          onChange={(v) => onChange({ from, to: v })}
        />
        {from || to ? (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            className="mb-0.5 font-body text-[12px] font-semibold text-stone-500 hover:text-stone-700"
          >
            Effacer
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const range = p.range(referenceDate);
          const active = from === range.from && to === range.to;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(range)}
              className={`rounded-full border px-3 py-1 font-body text-[12px] font-semibold transition-colors ${
                active
                  ? 'border-amber-400 bg-amber-50 text-amber-800'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-100'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
      />
    </label>
  );
}
