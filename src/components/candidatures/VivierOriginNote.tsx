'use client';

/**
 * Bloc « Origine » d'une candidature créée depuis le vivier (point 1 bis) :
 * d'où elle vient, qui l'a invitée, et ce que vaut son score — calculé à
 * l'invitation sur un CV qui peut dater. Panneau latéral ET page complète.
 */

import { vivierScoreLabel, vivierTimelineLabel } from '@/lib/vivier/origin';
import type { VivierOrigin } from '@/types/vivier-origin';

export function VivierOriginNote({ origin }: { origin: VivierOrigin }) {
  return (
    <div data-role="vivier-origin" className="rounded-[10px] border border-dash-border bg-dash-purple-light px-3 py-2">
      <p className="font-body text-[12px] font-semibold text-dash-text">Origine</p>
      <p className="font-body text-[12.5px] text-dash-text">{vivierTimelineLabel(origin)}</p>
      <p className="font-body text-[12px] text-dash-text-secondary">{vivierScoreLabel(origin)}</p>
    </div>
  );
}
