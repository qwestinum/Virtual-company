'use client';

/**
 * Filtres du sous-onglet rapport de campagne (cf. docs/specs/reporting.md
 * §3.2) : recherche · donneur d'ordre · période · tri. Contrôlé par le parent
 * (CampaignReportList).
 *
 * ⚠️ UNE SEULE RANGÉE, sur la barre d'outils partagée. C'était une carte
 * blanche à TROIS ÉTAGES (recherche, puis donneur + tri, puis huit puces de
 * période et deux sélecteurs de date) : trois fois la hauteur pour les mêmes
 * réglages, et un cadre que ni Campagnes ni Candidatures ne portent.
 *
 * La période passe en liste déroulante ; les bornes libres restent
 * atteignables par « Période personnalisée », qui les fait apparaître SOUS la
 * barre. Retirer une possibilité sans le dire ne la déplace pas, ça la
 * supprime — huit puces toujours dépliées pour un réglage qu'on pose une fois
 * ne se justifiaient pas pour autant.
 */

import { useState } from 'react';

import {
  Toolbar,
  ToolbarSearch,
  ToolbarSelect,
} from '@/components/ui/Toolbar';
import type { DonneurOption } from '@/components/reporting/DonneurOrdreSelect';
import {
  CAMPAIGN_SORT_LABELS,
  type CampaignSortKey,
} from '@/lib/reporting/campaign-report-display';
import {
  AUDIT_PERIOD_PRESET_KEYS,
  presetsByKeys,
} from '@/lib/reporting/period-presets';

const SORT_KEYS: CampaignSortKey[] = [
  'closed_desc',
  'closed_asc',
  'name_asc',
  'duration_desc',
];

/** Valeur de la liste « Période » quand l'utilisateur saisit ses bornes. */
const LIBRE = 'custom';

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
  const presets = presetsByKeys(AUDIT_PERIOD_PRESET_KEYS).map((p) => ({
    ...p,
    bornes: p.range(referenceDate),
  }));
  const courant = presets.find(
    (p) => p.bornes.from === period.from && p.bornes.to === period.to,
  );
  // ⚠️ Le choix « personnalisée » ne se DÉDUIT pas des bornes : sur une
  // période vide, il ne changerait rien et les deux champs de date
  // n'apparaîtraient jamais — l'option serait morte. On retient donc le choix.
  const [libre, setLibre] = useState(false);
  const valeur = courant
    ? courant.key
    : libre || period.from || period.to
      ? LIBRE
      : '';

  return (
    <div className="flex flex-col gap-2.5">
      <Toolbar>
        <ToolbarSearch
          value={search}
          onChange={onSearchChange}
          placeholder="Poste, campagne ou donneur d’ordre…"
        />

        <ToolbarSelect
          ariaLabel="Filtrer par donneur d’ordre"
          testId="donneur"
          value={donneurOrdreId}
          onChange={onDonneurChange}
        >
          <option value="">Tous les donneurs d’ordre</option>
          {donneurOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect
          ariaLabel="Filtrer par période de clôture"
          testId="periode"
          value={valeur}
          onChange={(v) => {
            setLibre(v === LIBRE);
            if (v === LIBRE) return;
            if (v === '') return onPeriodChange({ from: '', to: '' });
            const p = presets.find((x) => x.key === v);
            if (p) onPeriodChange(p.bornes);
          }}
        >
          <option value="">Depuis toujours</option>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value={LIBRE}>Période personnalisée…</option>
        </ToolbarSelect>

        <ToolbarSelect
          ariaLabel="Trier les campagnes"
          testId="tri"
          value={sortKey}
          onChange={(v) => onSortChange(v as CampaignSortKey)}
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {CAMPAIGN_SORT_LABELS[k]}
            </option>
          ))}
        </ToolbarSelect>
      </Toolbar>

      {valeur === LIBRE ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <DateField
            label="Du"
            value={period.from}
            onChange={(v) => onPeriodChange({ from: v, to: period.to })}
          />
          <DateField
            label="Au"
            value={period.to}
            onChange={(v) => onPeriodChange({ from: period.from, to: v })}
          />
        </div>
      ) : null}
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
    <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{ borderColor: 'var(--dash-border)', color: 'var(--dash-text)' }}
        className="orqa-field h-10 rounded-[10px] border bg-white px-3.5 font-body text-[13.5px]"
      />
    </label>
  );
}
