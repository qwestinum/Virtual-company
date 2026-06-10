'use client';

/**
 * Filtres du sous-onglet rapport de campagne (cf. docs/specs/reporting.md
 * §3.2) : période de clôture (chips réutilisés), recherche libre, donneur
 * d'ordre, et sélecteur de tri. Contrôlé par le parent (CampaignReportList).
 */

import { Search } from 'lucide-react';

import { PeriodFilter } from '@/components/reporting/PeriodFilter';
import {
  DonneurOrdreSelect,
  type DonneurOption,
} from '@/components/reporting/DonneurOrdreSelect';
import {
  CAMPAIGN_SORT_LABELS,
  type CampaignSortKey,
} from '@/lib/reporting/campaign-report-display';
import { AUDIT_PERIOD_PRESET_KEYS } from '@/lib/reporting/period-presets';

const SORT_KEYS: CampaignSortKey[] = [
  'closed_desc',
  'closed_asc',
  'name_asc',
  'duration_desc',
];

export function CampaignReportFilters({
  search,
  onSearchChange,
  period,
  onPeriodChange,
  referenceDate,
  donneurOrdreId,
  onDonneurChange,
  donneurOptions,
  sortKey,
  onSortChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  period: { from: string; to: string };
  onPeriodChange: (range: { from: string; to: string }) => void;
  referenceDate: Date;
  donneurOrdreId: string;
  onDonneurChange: (id: string) => void;
  donneurOptions: DonneurOption[];
  sortKey: CampaignSortKey;
  onSortChange: (key: CampaignSortKey) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2">
        <Search className="h-4 w-4 text-stone-400" aria-hidden />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          placeholder="Poste, intitulé de campagne ou donneur d'ordre…"
          className="w-full bg-transparent font-body text-[13px] text-stone-800 outline-none"
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <DonneurOrdreSelect
          options={donneurOptions}
          value={donneurOrdreId}
          onChange={onDonneurChange}
        />
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Trier par
          </span>
          <select
            value={sortKey}
            onChange={(e) => onSortChange(e.currentTarget.value as CampaignSortKey)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {CAMPAIGN_SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PeriodFilter
        from={period.from}
        to={period.to}
        onChange={onPeriodChange}
        presetKeys={AUDIT_PERIOD_PRESET_KEYS}
        referenceDate={referenceDate}
      />
    </div>
  );
}
