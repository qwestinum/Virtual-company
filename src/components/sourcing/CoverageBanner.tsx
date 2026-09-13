'use client';

import type { CoverageVerdict } from '@/types/sourcing';

/**
 * Couverture limitée d'une zone (spec §3.6). La limite est l'index public, pas
 * la requête : sans ce bandeau, le recruteur réécrirait sa requête en vain — et
 * relancer la même requête redonne exactement la même liste.
 */
export function CoverageBanner({ coverage }: { coverage: CoverageVerdict }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
      <p className="font-semibold">Couverture limitée pour cette zone</p>
      <p className="mt-1">
        {coverage.inZone} profil{coverage.inZone > 1 ? 's' : ''} sur {coverage.total} {coverage.inZone > 1 ? 'sont' : 'est'} dans la
        zone de {coverage.zoneLabel}. L’index public des profils couvre moins bien les régions peu
        peuplées : ce n’est pas votre requête qui est en cause.
      </p>
      <p className="mt-1 text-amber-800">
        Pour élargir, remplacez la ville par la région dans la requête, ou gardez cette liste si le
        poste permet une mobilité. Les profils hors zone portent leur localisation en évidence.
      </p>
    </div>
  );
}
