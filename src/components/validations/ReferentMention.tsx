'use client';

/**
 * Mention discrète du recruteur référent d'une campagne, sur la carte de
 * validation. C'est un REPÈRE, pas un titre : même taille et même ton que la
 * ligne de campagne qui la porte.
 *
 * Le référent est celui de la CAMPAGNE. Quand il n'y en a pas — ou qu'il a été
 * désactivé — on l'ÉCRIT (« référent non défini ») plutôt que de laisser un
 * vide : un blanc se lit « information non chargée », et fait douter du reste
 * de la carte.
 */

import {
  initialsOf,
  shortRecruiterName,
  type ReferentInfo,
} from '@/lib/hitl/referent-filter';

export function ReferentMention({
  referent,
}: {
  referent: ReferentInfo | null;
}) {
  if (!referent) {
    return (
      <span className="whitespace-nowrap text-stone-400 italic">
        référent non défini
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 font-data text-[8px] font-bold leading-none text-stone-600"
      >
        {initialsOf(referent.displayName)}
      </span>
      Réf. {shortRecruiterName(referent.displayName)}
    </span>
  );
}
