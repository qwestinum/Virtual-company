'use client';

/**
 * Pastille d'étape de parcours + badge « intervention humaine » — brique
 * partagée par la sélection (liste) et la vue détaillée de l'audit.
 * Lecture seule : l'audit affiche, le dashboard pilote.
 */

import { UserCheck } from 'lucide-react';

import {
  CANDIDATE_STAGE_COLORS,
  CANDIDATE_STAGE_LABELS,
  type CandidateJourney,
} from '@/lib/reporting/candidate-journey';

export function CandidateStagePill({
  journey,
  size = 'sm',
}: {
  journey: CandidateJourney;
  size?: 'sm' | 'md';
}) {
  const color = CANDIDATE_STAGE_COLORS[journey.stage];
  const pad = size === 'md' ? 'px-3 py-1 text-[12px]' : 'px-2.5 py-0.5 text-[11px]';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full font-body font-semibold text-white ${pad}`}
        style={{ backgroundColor: color }}
      >
        {CANDIDATE_STAGE_LABELS[journey.stage]}
      </span>
      {journey.humanIntervention ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-800"
          title="La décision a été modifiée par un humain (override du verdict IA)"
        >
          <UserCheck className="h-3 w-3" aria-hidden />
          Intervention humaine
        </span>
      ) : null}
    </span>
  );
}
