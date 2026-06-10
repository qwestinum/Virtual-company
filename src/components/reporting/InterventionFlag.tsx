'use client';

/**
 * Indicateur « intervention humaine sur le screening » — colonne dédiée de la
 * liste d'audit. `active` = la décision humaine a contredit le verdict IA
 * (override). Sinon, verdict IA conservé. Lecture seule.
 */

import { UserCheck } from 'lucide-react';

export function InterventionFlag({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-body text-[11px] font-semibold text-amber-800"
        title="Décision modifiée par un humain (override du verdict IA)"
      >
        <UserCheck className="h-3 w-3" aria-hidden />
        Modifié
      </span>
    );
  }
  return (
    <span
      className="font-body text-[12px] text-stone-300"
      title="Verdict IA conservé (aucune intervention humaine)"
    >
      —
    </span>
  );
}
