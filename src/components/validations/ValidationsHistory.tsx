'use client';

/**
 * Historique des décisions déjà tranchées (status 'sent').
 *
 * Extrait du hub pour lui laisser la place des deux sous-onglets. Purement
 * consultatif : aucune action, aucune décision — ce qui est parti est parti.
 */

import { formatDateTimeFr } from '@/lib/format/datetime';
import type { PendingValidation } from '@/types/hitl';

export function ValidationsHistory({
  items,
}: {
  items: PendingValidation[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[14px] font-bold text-stone-700">
        Historique des décisions
      </h2>
      {items.length === 0 ? (
        <p className="font-body text-[12px] text-stone-400 italic">
          Aucune décision envoyée pour le moment.
        </p>
      ) : (
        items.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="font-body text-[13px] font-semibold text-stone-800 truncate">
                {v.candidateName}
              </p>
              <p className="font-body text-[11px] text-stone-500">
                {v.campaignId} · {formatDateTimeFr(v.decidedAt ?? v.updatedAt)}
              </p>
            </div>
            <span
              className={`flex-shrink-0 rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${
                v.decision === 'accept'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-rose-100 text-rose-700'
              }`}
            >
              {v.decision === 'accept' ? 'Acceptée' : 'Refusée'}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
