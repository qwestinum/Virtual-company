'use client';

/**
 * Carte de section — TROIS NIVEAUX DE RELIEF, UNE SEULE COULEUR.
 *
 *   ① l'EN-TÊTE     — la teinte d'accueil `#ffe0ab`, en dégradé vers sa nuance
 *   ② le SOUS-BLOC  — la nuance (45 % sur le blanc), repliable
 *   ③ la RANGÉE     — blanc franc, bordure fine, coins arrondis
 *
 * Le corps de la carte est blanc : c'est lui qui fait ressortir les sous-blocs.
 *
 * ⚠️ UNE COULEUR POUR LES TROIS BLOCS (22/09/2026, demande du donneur
 * d'ordre). Chaque bloc portait la teinte de son registre — violet, turquoise,
 * orange. L'écran d'accueil se lisait comme trois sujets de trois natures ; il
 * n'en a qu'une : ce qui vous attend. Le SUJET reste dit par l'icône et le
 * titre, jamais par la couleur.
 *
 * Contrastes mesurés (texte et texte secondaire AA sur les deux niveaux) :
 * voir `--dash-accueil-bloc` dans `globals.css` et `socle-contraste.test.ts`.
 */

import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';

/** La nuance du sous-bloc : la teinte d'accueil à ce pourcentage sur le blanc. */
export const SUBTINT_PERCENT = 45;

const TEINTE = 'var(--dash-accueil-bloc)';
const NUANCE = `color-mix(in srgb, ${TEINTE} ${SUBTINT_PERCENT}%, var(--dash-surface))`;
/** L'en-tête : la teinte, qui se fond dans sa nuance. */
const DEGRADE = `linear-gradient(90deg, ${TEINTE}, ${NUANCE})`;
/** L'encre des icônes — même famille, 5,65:1 sur la teinte pleine. */
const ENCRE = 'var(--dash-beige-encre)';

export function TodayCard({
  id,
  icon: Icone,
  title,
  subtitle,
  children,
}: {
  /** Clé de mémorisation du repli. Sans elle, la carte ne se replie pas. */
  id?: string;
  /** L'icône du SUJET, devant le titre. Toujours la même pour un sujet. */
  icon?: LucideIcon;
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
          style={{ color: ENCRE }}
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
            background: ENCRE,
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
        border: '1px solid var(--dash-border)',
        borderLeft: `3px solid ${TEINTE}`,
        // Le corps est blanc : sans ça les sous-blocs, à la nuance, se
        // confondraient avec lui.
        background: 'var(--dash-surface)',
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
            borderBottom: ouvert ? '1px solid var(--dash-border)' : 'none',
            background: DEGRADE,
          }}
        >
          {entete}
        </button>
      ) : (
        <header
          className="flex items-start gap-2.5 px-4 py-3"
          style={{
            borderBottom: '1px solid var(--dash-border)',
            background: DEGRADE,
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
        background: NUANCE,
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
