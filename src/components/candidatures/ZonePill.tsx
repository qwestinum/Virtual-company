'use client';

/**
 * Pastille de ZONE de décision HITL (figée au scoring).
 *
 * Deux libellés à ne surtout pas confondre : « Proposé au refus » (zone
 * courante — rien n'est parti, un humain doit trancher) et « Refus
 * automatique » (zone LEGACY — le mail est réellement parti sans validation,
 * avant la mise en conformité RGPD). Les afficher pareil effacerait la seule
 * trace lisible de l'ancien régime.
 *
 * Repli sur le statut binaire pour les lignes historiques sans zone : elles
 * datent de l'ancien régime, d'où `auto_reject`.
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
      return { label: 'Zone de validation', cls: 'text-dash-orange bg-dash-orange-light' };
    case 'auto_accept':
      return { label: 'Acceptation automatique', cls: 'text-dash-green bg-dash-green-light' };
    case 'proposed_reject':
      return {
        label: 'Proposé au refus',
        cls: 'text-dash-orange bg-dash-orange-light',
      };
    default:
      return { label: 'Refusé (historique)', cls: 'text-dash-red bg-dash-red-light' };
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
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-[12px] font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
