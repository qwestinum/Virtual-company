'use client';

/**
 * Une ligne de la short-list de présélection vivier (V2, affichage préparatoire).
 * Colonnes : rang, identité, score de pertinence, filtres durs passés, fraîcheur.
 * La section Validation vivier complète (décisions) arrive en V3.
 */

import type { ShortlistEntry } from '@/types/vivier-preselection';

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/** Libellé de fraîcheur relatif à partir de la dernière mise à jour du dossier. */
function freshnessLabel(updatedAt: string): string {
  const d = Date.parse(updatedAt);
  if (Number.isNaN(d)) return '—';
  const months = Math.floor((Date.now() - d) / MS_PER_MONTH);
  if (months <= 0) return 'ce mois-ci';
  if (months === 1) return 'il y a 1 mois';
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'il y a 1 an' : `il y a ${years} ans`;
}

export function VivierPreselectionRow({ entry }: { entry: ShortlistEntry }) {
  const score = Math.round(entry.relevanceScore * 100);
  return (
    <tr className="border-t border-stone-100">
      <td className="px-2 py-2 text-center font-body text-[12px] text-stone-400">
        {entry.rank}
      </td>
      <td className="px-2 py-2">
        <div className="font-body text-[13px] font-semibold text-stone-800">
          {entry.nom}
        </div>
        <div className="font-body text-[11px] text-stone-400">{entry.email}</div>
      </td>
      <td className="px-2 py-2">
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-body text-[12px] font-semibold text-emerald-700">
          {score}%
        </span>
      </td>
      <td className="px-2 py-2">
        {entry.passedFilters.length === 0 ? (
          <span className="font-body text-[11px] text-stone-400">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {entry.passedFilters.map((f) => (
              <span
                key={f.criterionId}
                title={`${f.label} : ${f.matchedTerms.join(', ')}`}
                className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 font-body text-[11px] text-stone-600"
              >
                {f.label}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2 font-body text-[11px] text-stone-500">
        {freshnessLabel(entry.updatedAt)}
      </td>
    </tr>
  );
}
