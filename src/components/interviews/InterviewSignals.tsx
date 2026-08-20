'use client';

/**
 * Le signal de tête de la page Entretiens : une campagne dont la cible n'a
 * plus de référent actif sert EN CE MOMENT une page dégradée à des candidats.
 * Placé au-dessus des onglets, délibérément — cette information ne doit pas
 * être à faire défiler.
 *
 * Le reste (invitations qui traînent, liens éteints) n'est plus un « signal »
 * décoratif : c'est le contenu de l'onglet « En attente de réservation », avec
 * ses actions. Un avertissement sans bouton fait perdre deux fois du temps.
 */

import { AlertTriangle } from 'lucide-react';

import type { OrphanRow } from '@/lib/interviews/pipeline';

export function InterviewSignals({ orphans }: { orphans: OrphanRow[] }) {
  if (orphans.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {orphans.map((o) => (
        <div
          key={o.campaignId}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 font-body text-[13px] text-amber-900">
            <strong>{o.campaignName ?? o.campaignId}</strong> n’a plus de
            recruteur référent actif : {o.activeLinks}{' '}
            {o.activeLinks > 1 ? 'candidats voient' : 'candidat voit'} une page
            « momentanément indisponible ». Choisis un référent dans l’édition
            de la campagne.
          </p>
        </div>
      ))}

    </div>
  );
}
