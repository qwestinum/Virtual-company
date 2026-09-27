'use client';

/**
 * Bandeau des filtres ACTIFS, au-dessus d'un écran filtré par l'URL.
 *
 * Il existe pour une raison précise : quand un filtre vient d'un lien (une
 * carte campagne, un signal, une adresse collée), l'écran affiche une liste
 * partielle sans que rien ne le dise. Une liste courte se lit alors comme
 * « il n'y a que ça », et c'est le défaut que la refonte doit supprimer, pas
 * déplacer. Donc : le filtre est ÉCRIT, et il se retire en un clic.
 *
 * Chaque puce porte l'adresse de l'écran SANS elle : retirer un filtre est une
 * navigation, jamais une mutation d'état — le bouton Précédent le ramène.
 */

import Link from 'next/link';

export type ActiveFilter = {
  key: string;
  /** Ce que le filtre retient, en toutes lettres. */
  label: string;
  /** L'écran sans CE filtre (les autres sont conservés). */
  withoutHref: string;
};

export function ActiveFilterBar({
  filters,
  back,
  action,
}: {
  filters: readonly ActiveFilter[];
  /** Retour à l'objet d'où l'on vient (une campagne), en un clic. */
  back?: { label: string; href: string } | null;
  /** Action contextuelle offerte par le filtre courant (ex. revue groupée). */
  action?: React.ReactNode;
}) {
  if (filters.length === 0 && !back && !action) return null;

  return (
    <div
      data-active-filters
      className="flex flex-wrap items-center gap-2 border-b border-stone-200/70 bg-white/60 px-6 py-2.5"
    >
      {back ? (
        <Link
          href={back.href}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-md px-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        >
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : null}

      {filters.length > 0 ? (
        <span className="font-body text-[12px] text-stone-500">Filtré sur</span>
      ) : null}

      {filters.map((f) => (
        <span
          key={f.key}
          className="inline-flex min-h-6 items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-0.5 font-body text-[12px] font-semibold text-stone-700"
        >
          {f.label}
          <Link
            href={f.withoutHref}
            aria-label={`Retirer le filtre ${f.label}`}
            title={`Retirer le filtre ${f.label}`}
            className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-900"
          >
            <span aria-hidden>×</span>
          </Link>
        </span>
      ))}

      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}
