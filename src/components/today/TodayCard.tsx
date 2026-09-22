'use client';

/**
 * Carte de section — TRANSPARENTE, BORDÉE DE GRIS.
 *
 *   ① la CARTE      — aucun fond ; bordure et filet gauche gris
 *   ② le SOUS-BLOC  — aucun fond non plus ; même bordure, plus fine, repliable
 *   ③ la RANGÉE     — blanc franc, bordure fine : le seul aplat, c'est le contenu
 *
 * ⚠️ Historique du 22/09/2026 (demandes successives du donneur d'ordre) : les
 * trois blocs ont porté la teinte de leur registre, puis `#ffe0ab`, puis la
 * teinte du bandeau ; ils sont désormais TRANSPARENTS, bordés de gris. Le
 * sujet reste dit par l'icône et le titre — l'icône porte une couleur PROPRE à
 * chaque sujet (`iconColor`).
 *
 * ⚠️ Le gris SOUTENU du produit (`--dash-border-strong`), pas le gris de carte
 * (`--dash-border`) : sans fond, le bloc n'est délimité QUE par sa bordure, et
 * le gris clair ne se détache presque pas du fond sable de la page.
 */

import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';

const BORDURE = 'var(--dash-border-strong)';
/** L'encre par défaut des icônes, quand un sujet n'en fixe pas. */
const ENCRE = 'var(--dash-beige-encre)';

export function TodayCard({
  id,
  icon: Icone,
  iconColor = ENCRE,
  title,
  subtitle,
  children,
}: {
  /** Clé de mémorisation du repli. Sans elle, la carte ne se replie pas. */
  id?: string;
  /** L'icône du SUJET, devant le titre. Toujours la même pour un sujet. */
  icon?: LucideIcon;
  /** La couleur de l'icône — une par sujet ; ≥ 3:1 sur la teinte (mesuré). */
  iconColor?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const panneau = useId();
  // ⚠️ DÉPLIÉE PAR DÉFAUT, contrairement aux sous-blocs. Une carte repliée
  // n'affiche que son titre — « 14 candidatures attendent votre validation » —
  // et c'est exactement ce qu'on veut POUVOIR faire, pas ce qu'on veut
  // trouver en arrivant : l'écran existe pour montrer ce qui attend.
  const [replie, setReplie] = useState<boolean | null>(null);
  const memorise = id ? (replie ?? lireRepli(`carte.${id}`)) : null;
  const ouvert = memorise === null ? true : !memorise;
  const pliable = id !== undefined;

  const basculer = (): void => {
    if (!id) return;
    setReplie(ouvert);
    ecrireRepli(`carte.${id}`, ouvert);
  };

  const entete = (
    <>
      {Icone ? (
        <Icone
          aria-hidden
          className="mt-0.5 h-[18px] w-[18px] shrink-0"
          style={{ color: iconColor }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            marginTop: 5,
            width: 8,
            height: 8,
            borderRadius: 999,
            flexShrink: 0,
            background: iconColor,
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <h2
          className="font-display"
          style={{ fontSize: 15, fontWeight: 700, color: 'var(--dash-text)' }}
        >
          {title}
        </h2>
        {subtitle && ouvert ? (
          <p
            className="font-body"
            style={{
              marginTop: 2,
              fontSize: 12,
              color: 'var(--dash-text-secondary)',
              lineHeight: 1.45,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {pliable ? (
        ouvert ? (
          <ChevronDown aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
        )
      ) : null}
    </>
  );

  return (
    <section
      style={{
        borderRadius: 14,
        border: `1px solid ${BORDURE}`,
        borderLeft: `3px solid ${BORDURE}`,
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {pliable ? (
        <button
          type="button"
          onClick={basculer}
          aria-expanded={ouvert}
          aria-controls={panneau}
          data-today-card={id}
          className="flex w-full items-start gap-2.5 px-4 py-3 text-left"
          style={{
            borderBottom: ouvert ? `1px solid ${BORDURE}` : 'none',
          }}
        >
          {entete}
        </button>
      ) : (
        <header
          className="flex items-start gap-2.5 px-4 py-3"
          style={{
            borderBottom: `1px solid ${BORDURE}`,
          }}
        >
          {entete}
        </header>
      )}
      {ouvert ? (
        <div id={panneau} className="flex flex-col gap-2 p-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Repli mémorisé PENDANT LA SESSION : un confort, jamais un réglage. */
function lireRepli(cle: string): boolean | null {
  try {
    const v = window.sessionStorage.getItem(`orqa.today.fold.${cle}`);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function ecrireRepli(cle: string, replie: boolean): void {
  try {
    window.sessionStorage.setItem(`orqa.today.fold.${cle}`, replie ? '1' : '0');
  } catch {
    // Stockage indisponible : le sous-bloc s'ouvre par défaut. Dégradation
    // douce — jamais un écran qui refuse de s'afficher.
  }
}

/**
 * Sous-bloc — LE VERBE, dans un groupe visible et repliable.
 *
 * Déplié par défaut : on vient voir ce qui attend, pas le chercher. Un
 * sous-bloc VIDE, lui, se replie de lui-même — il reste sur une ligne, parce
 * qu'un verbe qui n'a rien à faire aujourd'hui doit quand même se voir (sinon
 * le total de la carte ne se retrouve nulle part).
 */
export function TodaySubBlock({
  id,
  title,
  subtitle,
  count,
  action,
  children,
}: {
  /** Clé de mémorisation du repli, stable d'un rendu à l'autre. */
  id: string;
  title: string;
  subtitle?: string;
  count: number;
  /** Bouton de lot, posé DANS l'en-tête : il porte sur tout le groupe. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [replie, setReplie] = useState<boolean | null>(null);
  // Un sous-bloc vide est replié, sauf si l'utilisateur l'a rouvert lui-même.
  const memorise = replie ?? lireRepli(id);
  const ouvert = memorise !== null ? !memorise : count > 0;

  const basculer = (): void => {
    const prochain = ouvert;
    setReplie(prochain);
    ecrireRepli(id, prochain);
  };

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${BORDURE}`,
        background: 'transparent',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <button
          type="button"
          onClick={basculer}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {ouvert ? (
            <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-stone-500" />
          ) : (
            <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-stone-500" />
          )}
          <span className="min-w-0">
            <span
              className="font-display block"
              style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-text)' }}
            >
              {title}
            </span>
            {subtitle && ouvert ? (
              <span
                className="font-body block"
                style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
              >
                {subtitle}
              </span>
            ) : null}
          </span>
        </button>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      {ouvert && count > 0 ? (
        <div className="flex flex-col gap-2 px-2 pb-2">{children}</div>
      ) : null}
    </div>
  );
}
