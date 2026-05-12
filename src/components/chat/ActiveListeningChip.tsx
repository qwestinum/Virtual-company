'use client';

import { Ear } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * Bandeau informatif permanent sous le sélecteur de campagne quand
 * la courante est `active` — c'est-à-dire que tous les jalons sont
 * franchis (FDP validée, annonces publiées, flux confirmés, scoring
 * validé) et que la campagne est **en écoute de flux CV**.
 *
 * Round 4 — couleur orange volontaire (mode "alerte douce" : il se
 * passe quelque chose, le système attend une action externe). Pulsation
 * discrète de l'icône pour signaler l'attente active.
 */
export function ActiveListeningChip({
  jobTitle,
  campaignId,
}: {
  jobTitle: string;
  campaignId: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-4 py-2',
        'bg-orange-50 border-b border-orange-200',
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'h-6 w-6 grid place-items-center rounded-full shrink-0',
          'bg-orange-100 text-orange-700 status-dot-active',
        )}
        // CSS variable consommée par status-dot-pulse pour le halo.
        // Cast nécessaire — React.CSSProperties ne couvre pas les
        // custom properties typées.
        style={{ '--pulse-color': 'rgba(234, 88, 12, 0.55)' } as CSSProperties}
        aria-hidden
      >
        <Ear className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] font-semibold text-orange-700 block">
          Campagne active
        </span>
        <span className="font-body text-[12px] text-orange-900/90 truncate block">
          <span className="font-data font-semibold tracking-tight">
            {campaignId}
          </span>
          <span className="font-normal text-orange-800/80">
            {' '}— {jobTitle}
          </span>
          <span className="font-normal italic text-orange-700/80">
            {' '}· en attente de flux CV
          </span>
        </span>
      </div>
    </div>
  );
}
