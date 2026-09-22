'use client';

/**
 * Carte de section — TROIS NIVEAUX DE RELIEF, aucun inventé.
 *
 *   ① la CARTE      — teinte du registre à 6 % sur le blanc, filet gauche
 *   ② le SOUS-BLOC  — même teinte, un cran plus dense (14 %), repliable
 *   ③ la RANGÉE     — blanc franc, bordure fine, coins arrondis
 *
 * ── TEINTE INVERSÉE (`teinte="inversee"`) ───────────────────────────────────
 * Les deux niveaux ÉCHANGENT leur place : l'en-tête prend la teinte dense, le
 * corps de la carte redevient blanc, et les sous-blocs prennent la nuance
 * légère. Le relief reste à trois niveaux et dans le même ordre de densité —
 * c'est l'ACCENT qui se déplace, du contenu vers le titre.
 *
 * Les deux teintes restent celles qui existent : aucune valeur nouvelle, donc
 * le contraste AA déjà mesuré sur chacune reste valable (cf.
 * `socle-contraste.test.ts`, qui les vérifie toutes les deux).
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

import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { DASH_COLORS, type DashColor } from '@/components/dashboard/tokens';

/** Teinte de la CARTE : le sujet. */
export const TINT_PERCENT = 6;
/** Teinte du SOUS-BLOC : le verbe. Un cran plus dense, jamais une couleur. */
export const SUBTINT_PERCENT = 14;

const tint = (accent: DashColor, pct: number): string =>
  `color-mix(in srgb, ${DASH_COLORS[accent].solid} ${pct}%, var(--dash-surface))`;

/**
 * Où porte la teinte. `normale` : le corps est teinté, l'en-tête le suit.
 * `inversee` : l'en-tête porte la teinte dense, le corps redevient blanc.
 */
export type TeinteCarte = 'normale' | 'inversee';

export function TodayCard({
  accent,
  id,
  icon: Icone,
  title,
  subtitle,
  teinte = 'normale',
  children,
}: {
  accent: DashColor;
  /** Clé de mémorisation du repli. Sans elle, la carte ne se replie pas. */
  id?: string;
  /** L'icône du SUJET, devant le titre. Toujours la même pour un sujet. */
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  teinte?: TeinteCarte;
  children: React.ReactNode;
}) {
  const inversee = teinte === 'inversee';
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
          style={{ color: DASH_COLORS[accent].solid }}
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
            background: DASH_COLORS[accent].solid,
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
        borderLeft: `3px solid ${DASH_COLORS[accent].solid}`,
        // Inversée, le corps redevient blanc : sans ça les sous-blocs, passés
        // à la nuance légère, se confondraient avec lui.
        background: inversee ? 'var(--dash-surface)' : tint(accent, TINT_PERCENT),
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
            background: inversee ? tint(accent, SUBTINT_PERCENT) : undefined,
          }}
        >
          {entete}
        </button>
      ) : (
        <header
          className="flex items-start gap-2.5 px-4 py-3"
          style={{
            borderBottom: '1px solid var(--dash-border)',
            background: inversee ? tint(accent, SUBTINT_PERCENT) : undefined,
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
  accent,
  id,
  title,
  subtitle,
  count,
  action,
  teinte = 'normale',
  children,
}: {
  accent: DashColor;
  /** Doit suivre celle de la carte qui le contient. */
  teinte?: TeinteCarte;
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
        background: tint(
          accent,
          teinte === 'inversee' ? TINT_PERCENT : SUBTINT_PERCENT,
        ),
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
