'use client';

/**
 * Les propositions DÉJÀ tranchées (contactées, écartées) de la campagne — en
 * lecture seule, sous la liste de ce qui attend une décision.
 */

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierPreselectionRow } from './VivierPreselectionRow';

export function VivierDecidedTable({ entries }: { entries: ShortlistEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-stone-50 text-left">
            <th className="px-2 py-2 text-center font-body text-[11px] font-semibold text-stone-500">
              #
            </th>
            <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
              Candidat
            </th>
            <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
              Pertinence
            </th>
            <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
              Origine
            </th>
            <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
              Fraîcheur
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <VivierPreselectionRow key={e.candidateId} entry={e} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
