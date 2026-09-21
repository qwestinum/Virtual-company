/**
 * LA PEAU D'UNE LISTE — une seule, désormais.
 *
 * ⚠️ Il y en a eu DEUX pendant un temps, et c'était délibéré : Candidatures
 * était le MODÈLE de structure (ruban de compteurs, ligne à avatar, puce
 * d'intitulé, pastille d'état) et, en même temps, l'intruse de la charte —
 * elle écrivait en Fraunces/Inter sur une palette marine et bleu-gris que
 * personne d'autre n'employait. Reprendre ses composants ailleurs y aurait
 * importé sa police ; les réécrire y aurait perdu sa structure. D'où un
 * paramètre, le temps du chantier.
 *
 * Le 21/09/2026, Candidatures a pris la peau du produit : la palette `orqa-*`
 * n'existe plus, les deux jeux rendaient les mêmes jetons, et un paramètre qui
 * n'a plus qu'une valeur est un piège — il laisse croire à un choix.
 *
 * ⚠️ AUCUNE ombre portée, AUCUNE bordure de sélection au-delà de 1 px : la
 * sélection se marque par la couleur de la bordure et le fond.
 */

/** Les classes de la liste. Les valeurs, elles, vivent dans `tokens.ts`. */
export const SKIN = {
  /** Carte : fond, bordure, rayon. */
  carte: 'rounded-[14px] border bg-white',
  /** Gros chiffre d'un compteur. */
  chiffre: 'font-data text-[26px] font-extrabold leading-none',
  /** Libellé d'un compteur. */
  libelle: 'font-body text-[11.5px]',
  /** Nom principal d'une ligne. */
  titre: 'font-display text-[14.5px] font-bold',
  /** Ligne secondaire, en gris. */
  meta: 'font-body text-[12px]',
  /** Pavé d'initiales. */
  avatar: 'rounded-[11px] font-data text-[13px] font-semibold tracking-wide text-white',
  /** Puce d'intitulé. */
  puce: 'rounded-md border font-body text-[12px] font-semibold',
} as const;

/**
 * Les valeurs que les classes Tailwind ne peuvent pas porter : les jetons du
 * produit sont des variables CSS, pas des classes.
 */
export const DASH = {
  bordure: 'var(--dash-border)',
  bordureForte: 'var(--dash-border-strong)',
  texte: 'var(--dash-text)',
  secondaire: 'var(--dash-text-secondary)',
  surface: 'var(--dash-surface)',
  chaud: 'var(--dash-warm)',
} as const;
