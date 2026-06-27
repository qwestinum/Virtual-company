'use client';

/**
 * Indicateur « tranché par un humain » — colonne dédiée de la liste d'audit.
 * HITL 3 zones : `active` = un humain a tranché la candidature en zone grise
 * (decidedBy = 'user'). Sinon, décision automatique du système. Lecture seule.
 */

import { UserCheck } from 'lucide-react';

export function InterventionFlag({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-body text-[11px] font-semibold text-amber-800"
        title="Candidature de la zone grise tranchée par un humain"
      >
        <UserCheck className="h-3 w-3" aria-hidden />
        Humain
      </span>
    );
  }
  return (
    <span
      className="font-body text-[12px] text-stone-300"
      title="Décision automatique du système (hors zone grise)"
    >
      —
    </span>
  );
}
