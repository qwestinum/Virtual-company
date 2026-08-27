'use client';

/**
 * Mention discrète du recruteur concerné, sur la ligne de campagne qui la
 * porte. C'est un REPÈRE, pas un titre.
 *
 * SURFACE PARTAGÉE — validations, entretiens, fiche candidature : même helper,
 * même taille, même séparateur, même pastille. Un recruteur ne doit pas avoir
 * à réapprendre à lire la même information d'un écran à l'autre.
 *
 * ⚠️ Aucune COULEUR de texte n'est imposée : la mention hérite de celle de son
 * hôte (`text-stone-500` côté validations et entretiens, `text-orqa-gris` sur
 * la fiche candidature). Coder une palette ici la rendrait fausse sur deux des
 * trois surfaces — « identique » veut dire même forme, pas même couleur qu'un
 * écran arbitrairement choisi.
 *
 * Quand il n'y a pas de référent — ou qu'il a été désactivé — on l'ÉCRIT
 * (« référent non défini ») plutôt que de laisser un vide : un blanc se lit
 * « information non chargée », et fait douter du reste de la ligne.
 */

import {
  asActiveReferent,
  initialsOf,
  shortRecruiterName,
  type ReferentInfo,
} from '@/lib/referent/filter';

export function ReferentMention({
  referent,
  supersededBy = null,
}: {
  referent: ReferentInfo | null;
  /**
   * Référent ACTUEL de la campagne, quand il DIFFÈRE de celui qui est affiché
   * — cas d'un rendez-vous déjà pris chez quelqu'un d'autre. On le DIT
   * discrètement : afficher le nouveau référent seul enverrait quelqu'un au
   * mauvais entretien, et le taire laisserait croire à une erreur.
   */
  supersededBy?: ReferentInfo | null;
}) {
  // La règle « désactivé ⇒ référent non défini » est appliquée ICI, une fois
  // pour toutes les surfaces : un appelant qui l'oublierait afficherait le nom
  // de quelqu'un qui a quitté l'espace, et le filtre le classerait ailleurs.
  const shown = asActiveReferent(referent);
  const current = asActiveReferent(supersededBy);
  if (!shown) {
    return (
      <span className="whitespace-nowrap italic opacity-70">
        référent non défini
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-stone-200 font-data text-[8px] font-bold leading-none text-stone-600"
      >
        {initialsOf(shown.displayName)}
      </span>
      <span className="whitespace-nowrap">
        Réf. {shortRecruiterName(shown.displayName)}
      </span>
      {current ? (
        <span className="whitespace-nowrap opacity-70">
          · référent actuel : {shortRecruiterName(current.displayName)}
        </span>
      ) : null}
    </span>
  );
}
