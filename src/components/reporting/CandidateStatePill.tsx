'use client';

/**
 * Pastille compacte = état COURANT du parcours (le plus avancé atteint).
 * Pour la colonne « Statut actuel » de la liste de sélection. Lecture seule.
 * L'intervention humaine a sa propre colonne (cf. `InterventionFlag`).
 */

import {
  JOURNEY_TONE_COLORS,
  journeyCurrentState,
  type CandidateJourney,
} from '@/lib/reporting/candidate-journey';

export function CandidateStatePill({ journey }: { journey: CandidateJourney }) {
  const current = journeyCurrentState(journey);
  return (
    <span
      className="flex w-full items-center justify-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-center font-body text-[11px] font-semibold text-white"
      style={{ backgroundColor: JOURNEY_TONE_COLORS[current.tone] }}
    >
      {current.label}
    </span>
  );
}
