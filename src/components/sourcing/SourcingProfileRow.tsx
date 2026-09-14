'use client';

/**
 * Une ligne par profil (spec §14.3, ajustement du 14/09/2026).
 *
 * REPLIÉE, elle porte l'essentiel pour balayer vite : intitulé actuel —
 * entreprise — localisation — ancienneté dans le poste. `slot` accueille les
 * repères du lot 3 (en recherche, mentions, vivier) sans déplacer le reste.
 * DÉPLIÉE, elle montre la matière pour décider, en sections
 * (`SourcingProfileDetail`), actions en pied.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { tenureLabel } from '@/lib/sourcing/display';
import type { SourcingProfileView } from '@/types/sourcing';

import { SourcingProfileDetail } from './SourcingProfileDetail';

export function SourcingProfileRow({
  profile,
  expanded,
  onToggle,
  slot,
  actions,
}: {
  profile: SourcingProfileView;
  expanded: boolean;
  onToggle: (id: string) => void;
  slot?: ReactNode;
  actions?: ReactNode;
}) {
  const s = profile.snapshot;
  const tenure = s.current ? tenureLabel(s.current.since) : null;
  const outOfZone = profile.inZone === false;
  const summary = [
    s.current?.title ?? s.headline ?? 'Poste actuel non renseigné',
    s.current?.company ?? null,
  ].filter(Boolean);

  return (
    <li data-profile-row={profile.id} className="rounded-md border border-stone-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`profile-detail-${profile.id}`}
          onClick={() => onToggle(profile.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          )}
          <span className="min-w-0 truncate font-body text-[13px] text-stone-800">
            <span className="font-display text-[14px] font-bold text-stone-900">{s.name}</span>
            <span className="text-stone-400"> · </span>
            <span className="font-semibold">{summary.join(' — ')}</span>
            <span className={outOfZone ? 'font-semibold text-amber-800' : 'text-stone-500'}>
              {' — '}
              {s.location ?? 'localisation non renseignée'}
              {outOfZone ? ' (hors zone)' : ''}
            </span>
            {tenure ? <span className="text-stone-500"> — {tenure}</span> : null}
          </span>
        </button>
        {slot ? <span className="flex shrink-0 items-center gap-1.5">{slot}</span> : null}
        {/* Dépliée, les actions passent en pied de détail : une seule place à la fois. */}
        {actions && !expanded ? <span className="flex shrink-0 items-center gap-1.5">{actions}</span> : null}
      </div>

      {expanded ? <SourcingProfileDetail profile={profile} actions={actions} /> : null}
    </li>
  );
}
