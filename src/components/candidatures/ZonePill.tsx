'use client';

/**
 * Pastille de ZONE de décision HITL (figée au scoring). Reflète `decisionZone`
 * (gris = « Zone de validation »), repli sur le statut binaire pour les lignes
 * historiques sans zone.
 */

import type { DecisionZone } from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

function resolve(
  zone: DecisionZone | null,
  status: CandidateStatus,
): { label: string; cls: string } {
  const z = zone ?? (status === 'accepted' ? 'auto_accept' : 'auto_reject');
  switch (z) {
    case 'gray':
      return { label: 'Zone de validation', cls: 'text-orqa-ambre bg-orqa-ambre-bg' };
    case 'auto_accept':
      return { label: 'Acceptation automatique', cls: 'text-orqa-vert bg-orqa-vert-bg' };
    default:
      return { label: 'Refus automatique', cls: 'text-orqa-rouge bg-orqa-rouge-bg' };
  }
}

export function ZonePill({
  zone,
  status,
}: {
  zone: DecisionZone | null;
  status: CandidateStatus;
}) {
  const { label, cls } = resolve(zone, status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-inter text-[12px] font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
