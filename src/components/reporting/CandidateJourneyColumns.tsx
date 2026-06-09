'use client';

/**
 * Affichage du parcours en COLONNES (une par phase, états mutuellement
 * exclusifs). Les phases non atteintes sont grisées. Lecture seule : le
 * pilotage reste dans le Dashboard.
 */

import { ChevronRight, UserCheck } from 'lucide-react';

import {
  JOURNEY_TONE_COLORS,
  journeyColumns,
  type CandidateJourney,
} from '@/lib/reporting/candidate-journey';

export function CandidateJourneyColumns({
  journey,
}: {
  journey: CandidateJourney;
}) {
  const columns = journeyColumns(journey);
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-1">
        {columns.map((col, i) => (
          <div key={col.key} className="flex items-stretch gap-1">
            <div
              className={`flex min-w-[130px] flex-1 flex-col gap-1 rounded-lg border px-3 py-2 ${
                col.reached
                  ? 'border-stone-200 bg-white'
                  : 'border-dashed border-stone-200 bg-stone-50/60'
              }`}
            >
              <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                {col.title}
              </span>
              <span
                className="inline-flex w-fit items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold"
                style={
                  col.reached
                    ? { backgroundColor: JOURNEY_TONE_COLORS[col.tone], color: '#fff' }
                    : { backgroundColor: '#f5f5f4', color: '#a8a29e' }
                }
              >
                {col.label}
              </span>
            </div>
            {i < columns.length - 1 ? (
              <ChevronRight
                className="h-4 w-4 shrink-0 self-center text-stone-300"
                aria-hidden
              />
            ) : null}
          </div>
        ))}
      </div>
      {journey.humanIntervention ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-body text-[12px] font-semibold text-amber-800">
          <UserCheck className="h-3.5 w-3.5" aria-hidden />
          Intervention humaine — la décision a été modifiée par rapport au verdict IA du screening.
        </p>
      ) : null}
    </div>
  );
}
