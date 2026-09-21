/**
 * LA PEAU d'une liste — deux jeux, une seule structure.
 *
 * ⚠️ Pourquoi un paramètre et non deux composants. Candidatures est le MODÈLE
 * de structure (ruban de compteurs compacts, ligne à avatar, puce d'intitulé,
 * pastille d'état) et, en même temps, l'intruse de la charte : elle écrit en
 * Fraunces/Inter sur des couleurs `orqa-*` que personne d'autre n'emploie. La
 * reprendre telle quelle sur Entretiens et Pilotage y importerait sa police ;
 * la réécrire y perdrait sa structure.
 *
 * Donc : les mêmes composants, et la peau en paramètre. Candidatures garde
 * `'orqa'` jusqu'au lot des jetons ; Entretiens et Pilotage prennent `'dash'`,
 * la police et les couleurs de Campagnes.
 *
 * ⚠️ AUCUNE ombre portée, AUCUNE bordure de sélection au-delà de 1 px : ni
 * l'une ni l'autre n'existe sur les écrans de référence, et l'ombre fabrique
 * un relief que rien d'autre ne porte.
 */

export type ListSkin = 'orqa' | 'dash';

type Jeu = {
  /** Carte : fond, bordure, rayon. */
  carte: string;
  carteSelection: string;
  /** Gros chiffre d'un compteur. */
  chiffre: string;
  /** Libellé d'un compteur. */
  libelle: string;
  /** Nom principal d'une ligne. */
  titre: string;
  /** Ligne secondaire, en gris. */
  meta: string;
  /** Pavé d'initiales. */
  avatar: string;
  /** Puce d'intitulé. */
  puce: string;
};

export const SKINS: Record<ListSkin, Jeu> = {
  orqa: {
    carte: 'rounded-[14px] border border-orqa-ligne bg-white',
    carteSelection: 'border-orqa-nuit bg-orqa-cielbg',
    chiffre: 'font-fraunces text-[26px] font-semibold leading-none text-orqa-nuit',
    libelle: 'font-inter text-[11.5px] text-orqa-gris',
    titre: 'font-inter text-[14.5px] font-semibold text-orqa-encre',
    meta: 'font-inter text-[12px] text-orqa-gris',
    avatar:
      'rounded-[11px] bg-gradient-to-br from-orqa-nuit to-orqa-nuit2 font-inter text-[13px] font-semibold tracking-wide text-white',
    puce: 'rounded-md border border-orqa-ciel-clair/50 bg-orqa-cielbg font-inter text-[12px] font-semibold text-orqa-nuit',
  },
  dash: {
    carte: 'rounded-[14px] border bg-white',
    carteSelection: '',
    chiffre: 'font-data text-[26px] font-extrabold leading-none',
    libelle: 'font-body text-[11.5px]',
    titre: 'font-display text-[14.5px] font-bold',
    meta: 'font-body text-[12px]',
    avatar: 'rounded-[11px] font-data text-[13px] font-semibold tracking-wide text-white',
    puce: 'rounded-md border font-body text-[12px] font-semibold',
  },
};

/**
 * Les valeurs que la peau `dash` ne peut pas écrire en classes Tailwind : les
 * jetons du produit ne sont pas des classes, ce sont des variables CSS.
 */
export const DASH = {
  bordure: 'var(--dash-border)',
  bordureForte: 'var(--dash-border-strong)',
  texte: 'var(--dash-text)',
  secondaire: 'var(--dash-text-secondary)',
  surface: 'var(--dash-surface)',
  chaud: 'var(--dash-warm)',
} as const;
