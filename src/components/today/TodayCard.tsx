'use client';

/**
 * Carte de section — TROIS NIVEAUX DE RELIEF, aucun inventé.
 *
 *   ① la CARTE      — teinte du registre à 6 % sur le blanc, filet gauche
 *   ② le SOUS-BLOC  — même teinte, un cran plus dense (14 %), repliable
 *   ③ la RANGÉE     — blanc franc, bordure fine, coins arrondis
 *
 * L'écart entre les trois doit se lire à 50 % de zoom SANS texte : c'est lui
 * qui dit « ceci contient cela » sans qu'on ait à le comprendre. Un trait fin
 * comme seul séparateur ne le disait pas — il séparait sans hiérarchiser.
 *
 * ⚠️ Les teintes restent des NUANCES : la page demeure blanche à l'œil et le
 * texte garde son contraste AA sur les deux niveaux. Vérifié par test, parce
 * qu'une teinte « juste un peu plus visible » est exactement l'ajustement qui
 * passe inaperçu et casse l'accessibilité.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { DASH_COLORS, type DashColor } from '@/components/dashboard/tokens';

/** Teinte de la CARTE : le sujet. */
export const TINT_PERCENT = 6;
/** Teinte du SOUS-BLOC : le verbe. Un cran plus dense, jamais une couleur. */
export const SUBTINT_PERCENT = 14;

const tint = (accent: DashColor, pct: number): string =>
  `color-mix(in srgb, ${DASH_COLORS[accent].solid} ${pct}%, var(--dash-surface))`;

export function TodayCard({
  accent,
  title,
  subtitle,
  children,
}: {
  accent: DashColor;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        borderRadius: 14,
        border: '1px solid var(--dash-border)',
        borderLeft: `3px solid ${DASH_COLORS[accent].solid}`,
        background: tint(accent, TINT_PERCENT),
        overflow: 'hidden',
      }}
    >
      <header
        className="flex items-start gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid var(--dash-border)' }}
      >
        <span
          aria-hidden
          style={{
            marginTop: 5,
            width: 8,
            height: 8,
            borderRadius: 999,
            flexShrink: 0,
            background: DASH_COLORS[accent].solid,
          }}
        />
        <div className="min-w-0">
          <h2
            className="font-display"
            style={{ fontSize: 15, fontWeight: 700, color: 'var(--dash-text)' }}
          >
            {title}
          </h2>
          {subtitle ? (
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
      </header>
      <div className="flex flex-col gap-2 p-2">{children}</div>
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
  accent,
  id,
  title,
  subtitle,
  count,
  action,
  children,
}: {
  accent: DashColor;
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
        background: tint(accent, SUBTINT_PERCENT),
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
