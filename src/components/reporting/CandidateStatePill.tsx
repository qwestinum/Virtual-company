'use client';

/**
 * Pastille compacte = état COURANT du parcours (le plus avancé atteint) +
 * badge « intervention humaine ». Pour la liste de sélection. Lecture seule.
 */

import { UserCheck } from 'lucide-react';

import {
  JOURNEY_TONE_COLORS,
  journeyCurrentState,
  type CandidateJourney,
} from '@/lib/reporting/candidate-journey';

export function CandidateStatePill({ journey }: { journey: CandidateJourney }) {
  const current = journeyCurrentState(journey);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold text-white"
        style={{ backgroundColor: JOURNEY_TONE_COLORS[current.tone] }}
      >
        {current.label}
      </span>
      {journey.humanIntervention ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-body text-[10px] font-semibold text-amber-800"
          title="Décision modifiée par un humain (override du verdict IA)"
        >
          <UserCheck className="h-3 w-3" aria-hidden />
        </span>
      ) : null}
    </span>
  );
}
