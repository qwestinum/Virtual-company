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

import { DASH, SKIN } from './list-skin';
import { PASTILLE } from './tokens';

export function ListRow({
  initials,
  avatar,
  avatarColor,
  title,
  pill,
  reference,
  meta,
  right,
  selected = false,
  tint,
  onClick,
  testId,
}: {
  /**
   * Initiales d'une PERSONNE. Absentes ⇒ aucun pavé : une campagne n'a pas
   * d'initiales, et lui en fabriquer (« BA » pour « Business Analyst ») la
   * fait passer pour quelqu'un.
   */
  initials?: string;
  /** Pastille TOUTE FAITE — l'icône d'une campagne, là où il n'y a pas de personne. */
  avatar?: ReactNode;
  /**
   * Fond du pavé d'initiales. Par défaut la couleur des PERSONNES, et il n'y
   * a pas de raison d'en changer : la couleur dit la nature de l'objet, pas
   * son état (cf. `PASTILLE`).
   */
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
  /**
   * Fond de la ligne, à la place du blanc. Pour MARQUER UN GROUPE (les
   * campagnes déjà sourcées), jamais pour coder un état individuel : l'état
   * vit dans la pastille de droite.
   */
  tint?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const s = SKIN;
  const contenu = (
    <>
      {avatar ?? (
        initials ? (
          <span
            className={`grid h-10 w-10 place-items-center ${s.avatar}`}
            style={{
            background: avatarColor ?? PASTILLE.candidat,
            color: PASTILLE.candidatEncre,
          }}
          >
            {initials}
          </span>
        ) : null
      )}

      <span className="min-w-0">
        <span
          className={`block truncate ${s.titre}`}
          style={{ color: DASH.texte }}
        >
          {title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          {pill ? (
            <span
              className={`inline-flex min-w-0 max-w-full shrink items-center truncate px-2 py-0.5 ${s.puce}`}
              style={{
                borderColor: DASH.bordureForte,
                background: DASH.chaud,
                color: DASH.texte,
              }}
            >
              {pill}
            </span>
          ) : null}
          {reference || meta ? (
            <span
              className={`shrink-0 truncate ${s.meta}`}
              style={{ color: DASH.secondaire }}
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

  const classe = `grid w-full ${
    initials || avatar ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'
  } items-center gap-4 px-4 py-3.5 text-left transition ${
    tint ? s.carte.replace('bg-white', '') : s.carte
  }`;
  const style = {
    borderColor: selected ? 'var(--dash-blue)' : DASH.bordure,
    ...(tint ? { background: tint } : null),
  };

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
