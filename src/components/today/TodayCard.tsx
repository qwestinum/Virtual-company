'use client';

/**
 * Carte de section — la carte EXISTANTE du produit, teintée par son registre.
 *
 * Bordure fine `--dash-border`, coins arrondis, AUCUNE ombre portée. C'est la
 * carte de Campagnes et de Réglages : cet écran l'applique, il ne la redessine
 * pas.
 *
 * REGISTRE — trois signaux, aucun ne suffisant seul :
 *   1. un fond très dilué de la couleur du registre (≈ 6 % sur le blanc) ;
 *   2. un filet gauche de 3 px de la même couleur ;
 *   3. une pastille devant le titre.
 *
 * ⚠️ La teinte est une NUANCE, pas une couleur : à 6 % d'opacité la page reste
 * blanche à l'œil et le texte garde son contraste (le fond effectif est à
 * moins de 1,05:1 du blanc — le calcul de contraste du texte ne bouge pas).
 * C'est vérifié par test, parce qu'une teinte « juste un peu plus visible »
 * est exactement le genre d'ajustement qui passe inaperçu et casse l'AA.
 */

import { DASH_COLORS, type DashColor } from '@/components/dashboard/tokens';

/**
 * Part de la couleur de registre mélangée au blanc. 6 % : assez pour que trois
 * blocs se distinguent à 50 % de zoom sans lire, trop peu pour que la page
 * cesse d'être blanche. Au-delà de 8 % la teinte devient une couleur et le
 * contraste du texte commence à bouger.
 */
export const TINT_PERCENT = 6;

export function TodayCard({
  accent,
  title,
  subtitle,
  children,
}: {
  /** Jeton de couleur EXISTANT — teal/violet pour les candidats, ambre sinon. */
  accent: DashColor;
  /** Phrase complète : chiffre + verbe, du point de vue du recruteur. */
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
        // `color-mix` plutôt qu'un hex figé : la teinte SUIT le jeton. Changer
        // `--dash-teal` change la nuance, sans qu'une seconde valeur traîne.
        background: `color-mix(in srgb, ${DASH_COLORS[accent].solid} ${TINT_PERCENT}%, var(--dash-surface))`,
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
      <div className="px-4 py-1.5">{children}</div>
    </section>
  );
}
