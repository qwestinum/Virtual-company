'use client';

/**
 * Une ligne de la short-list de présélection vivier (affichage préparatoire).
 * Colonnes : rang, identité, score, ORIGINE du match (correspondance de titre /
 * titre proche), fraîcheur.
 */

import { freshnessLabel } from '@/lib/vivier/freshness-label';
import type { ShortlistEntry } from '@/types/vivier-preselection';

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
        {entry.matchKind === 'title_exact' ? (
          <span
            title={entry.matchTerm ? `Correspondance de titre : ${entry.matchTerm}` : undefined}
            className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-body text-[11px] font-semibold text-emerald-800"
          >
            {/* Ancre qui a matché (titre déclaré / dernier poste / poste précédent). */}
            {entry.matchAnchorLabel ?? 'Correspondance de titre'}
            {entry.matchTerm ? ` · ${entry.matchTerm}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 font-body text-[11px] text-stone-600">
            Titre proche
          </span>
        )}
      </td>
      <td className="px-2 py-2 font-body text-[11px] text-stone-500">
        {freshnessLabel(entry.updatedAt)}
      </td>
    </tr>
  );
}
