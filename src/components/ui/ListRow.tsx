'use client';

/**
 * LA LIGNE DE LISTE — extraite de `CandidatureRow`, qui en était le modèle.
 *
 * Carte blanche à coins arrondis : pavé d'initiales, nom en gras, puce
 * d'intitulé, référence et délai en gris ; à droite, ce que l'écran a à
 * montrer (état, pastille, actions).
 *
 * ⚠️ La référence `CAMP-XXXX` est le SEUL endroit où la chasse fixe survit —
 * c'est un identifiant qu'on recopie, pas une valeur qu'on lit. Partout
 * ailleurs elle fait ressembler du texte ordinaire à du code.
 *
 * ⚠️ Aucune ombre portée, bordure de 1 px : la sélection se marque par la
 * couleur de la bordure et le fond, jamais par un relief.
 */

import type { ReactNode } from 'react';

import { DASH, SKINS, type ListSkin } from './list-skin';

export function ListRow({
  initials,
  avatarColor,
  title,
  pill,
  reference,
  meta,
  right,
  selected = false,
  onClick,
  skin = 'dash',
  testId,
}: {
  initials: string;
  /** Fond du pavé d'initiales (peau `dash`). */
  avatarColor?: string;
  title: string;
  /** Intitulé du poste, en puce — une fois, jamais répété sur la ligne. */
  pill?: string | null;
  /** Référence métier : le seul monospace de la ligne. */
  reference?: string | null;
  /** Délai, dates — en gris, à la suite de la référence. */
  meta?: string | null;
  right?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  skin?: ListSkin;
  testId?: string;
}) {
  const s = SKINS[skin];
  const contenu = (
    <>
      <span
        className={`grid h-10 w-10 place-items-center ${s.avatar}`}
        style={skin === 'dash' ? { background: avatarColor ?? 'var(--dash-blue)' } : undefined}
      >
        {initials}
      </span>

      <span className="min-w-0">
        <span
          className={`block truncate ${s.titre}`}
          style={skin === 'dash' ? { color: DASH.texte } : undefined}
        >
          {title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          {pill ? (
            <span
              className={`inline-flex min-w-0 max-w-full shrink items-center truncate px-2 py-0.5 ${s.puce}`}
              style={
                skin === 'dash'
                  ? { borderColor: DASH.bordureForte, background: DASH.chaud, color: DASH.texte }
                  : undefined
              }
            >
              {pill}
            </span>
          ) : null}
          {reference || meta ? (
            <span
              className={`shrink-0 truncate ${s.meta}`}
              style={skin === 'dash' ? { color: DASH.secondaire } : undefined}
            >
              {reference ? <span className="font-data">{reference}</span> : null}
              {reference && meta ? ' · ' : null}
              {meta}
            </span>
          ) : null}
        </span>
      </span>

      <span className="flex items-center justify-end gap-3">{right}</span>
    </>
  );

  const classe = `grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3.5 text-left transition ${s.carte} ${
    selected && skin === 'orqa' ? s.carteSelection : ''
  }`;
  const style =
    skin === 'dash'
      ? { borderColor: selected ? 'var(--dash-blue)' : DASH.bordure }
      : undefined;

  if (!onClick) {
    return (
      <div data-list-row={testId} className={classe} style={style}>
        {contenu}
      </div>
    );
  }
  return (
    <button type="button" data-list-row={testId} onClick={onClick} className={classe} style={style}>
      {contenu}
    </button>
  );
}
