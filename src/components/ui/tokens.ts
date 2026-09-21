/**
 * LE SOCLE DE JETONS DU PRODUIT — un seul fichier, et c'est celui-ci.
 *
 * ⚠️ Il ne DESSINE rien de nouveau. Il NOMME ce qui existait déjà et que
 * chaque écran réécrivait à sa façon : Campagnes en `--dash-*`, Candidatures en
 * `orqa-*` (Fraunces, marine, bleu-gris), l'accueil en valeurs directes. Trois
 * vocabulaires pour un seul produit, et aucune façon de voir la divergence.
 *
 * Les VALEURS vivent dans `globals.css` sous forme de variables CSS. Ce fichier
 * n'expose que des `var(…)` : changer une couleur reste un geste unique, en
 * CSS, et le thème sombre continue de fonctionner sans que personne n'y touche
 * ici.
 *
 * ── LES TROIS NIVEAUX TYPOGRAPHIQUES ────────────────────────────────────────
 * Trois, pas plus. Un quatrième niveau ne se distingue plus du troisième et
 * n'ajoute qu'une décision à prendre à chaque écran.
 *
 * ── L'ÉCHELLE D'ESPACEMENT ──────────────────────────────────────────────────
 * Multiples de 4, nommés par emploi. Un espacement choisi « à l'œil » est un
 * espacement qu'on ne peut pas reproduire ailleurs.
 *
 * ── LES BORNES DE CONTRASTE ─────────────────────────────────────────────────
 * Trois profondeurs : la CARTE (posée sur la page), le SOUS-BLOC (dans une
 * carte), la RANGÉE (dans un sous-bloc). Chacune se distingue de la
 * précédente par sa bordure et son fond — jamais par une ombre, qui fabrique
 * un relief que rien d'autre ne porte.
 *
 * ⚠️ WCAG 1.4.11 : une bordure qui sépare deux surfaces est un élément non
 * textuel et doit atteindre 3:1 CONTRE CE QU'ELLE SÉPARE. `--dash-border`
 * (1,22:1 sur blanc) ne le fait PAS — c'est un liseré de confort, pas une
 * limite porteuse de sens. Une limite qui doit se voir prend
 * `bordure.marquee`, et un champ de saisie prend `--dash-field-border`
 * (3,4:1), qui existe pour ça.
 */

/** Les trois niveaux, et le quatrième qui n'en est pas un (la chasse fixe). */
export const TYPO = {
  /** Titre de page et de carte. 22 px en tête d'écran, 15 px sur une carte. */
  titre: 'font-display font-bold',
  /** Le texte courant : libellés, phrases, métadonnées. */
  corps: 'font-body',
  /**
   * CHIFFRES ET IDENTIFIANTS uniquement — un compteur, une note, une
   * référence `CAMP-YYYY-NNN`. Partout ailleurs, la chasse fixe fait
   * ressembler du texte ordinaire à du code.
   */
  donnee: 'font-data',
} as const;

/** Tailles, en pixels, nommées par emploi. */
export const TAILLE = {
  titrePage: 22,
  titreCarte: 15,
  corps: 13,
  petit: 12,
  minuscule: 11,
  /** Le grand chiffre d'une carte-compteur. */
  compteur: 26,
} as const;

/**
 * Échelle d'espacement — multiples de 4, nommés par EMPLOI et non par taille.
 * `ESPACE.entreChamps` se relit ; `ESPACE.md` ne dit rien.
 */
export const ESPACE = {
  /** Entre un libellé et son champ. */
  libelleChamp: 4,
  /** Entre deux éléments d'une même ligne. */
  dansLigne: 8,
  /** Entre deux lignes d'une liste. */
  entreLignes: 12,
  /** Entre deux blocs de tête du gabarit (outils, compteurs). */
  entreBlocs: 16,
  /** Entre un titre de page et ce qui suit. */
  apresTitre: 20,
  /** Entre deux sections d'un écran. */
  entreSections: 24,
} as const;

/** Rôles de couleur — ce que la couleur DIT, jamais la couleur elle-même. */
export const COULEUR = {
  /** Le fond de la page. Uni, sand, il ne dit rien — et c'est voulu. */
  page: 'var(--dash-bg)',
  /** Une surface posée sur la page. */
  surface: 'var(--dash-surface)',
  /** Une surface tiède : sélection, zone de réglage, en-tête de groupe. */
  surfaceTiede: 'var(--dash-warm)',
  /** Le survol d'une surface. */
  survol: 'var(--dash-hover)',
  texte: 'var(--dash-text)',
  texteSecondaire: 'var(--dash-text-secondary)',
  /** ⚠️ 2,87:1 — SOUS AA. Jamais pour du texte qu'il faut lire. */
  texteTertiaire: 'var(--dash-text-tertiary)',
} as const;

/** Les trois profondeurs, et la bordure de chacune. */
export const BORDURE = {
  /** Liseré de confort. 1,22:1 — ne porte AUCUN sens à lui seul. */
  discrete: 'var(--dash-border)',
  /** Limite qui se voit : sélection, séparation porteuse de sens. */
  marquee: 'var(--dash-border-strong)',
  /** Bordure d'un champ de saisie. 3,4:1 — conforme WCAG 1.4.11. */
  champ: 'var(--dash-field-border)',
} as const;

/**
 * LA PALETTE D'ÉTAPES — une couleur par étape d'une candidature, la même
 * partout : pastille d'état, point d'une carte-compteur, segment d'entonnoir,
 * pavé d'initiales.
 *
 * ⚠️ Ce sont des REPÈRES, pas des couleurs de texte. Mesurées sur leur propre
 * fond clair elles donnent 2,83 à 3,44:1 — assez pour un élément non textuel
 * (WCAG 1.4.11 : 3:1), SOUS AA pour du texte. Le texte d'une pastille d'état
 * prend les teintes `--dash-*-text` (4,56 · 6,95 · 4,59 · 5,68:1), exposées
 * par `STAGE_TONE_COLOR`.
 *
 * C'est ce qui a fait retirer le marine `#0a1f3f` et le bleu-gris `#64748b` de
 * Candidatures : ils n'appartenaient à aucune échelle et ne se retrouvaient
 * sur aucun autre écran.
 */
export const ETAPE = {
  aValider: 'var(--dash-yellow)',
  invite: 'var(--dash-blue)',
  rdvPris: 'var(--dash-purple)',
  entretienFait: 'var(--dash-teal)',
  retenu: 'var(--dash-green)',
  nonRetenu: 'var(--dash-red)',
  refusAuto: 'var(--dash-red)',
  sansSuite: 'var(--dash-text-tertiary)',
} as const;

/** Rayons — trois, par taille d'objet. */
export const RAYON = {
  petit: 8,
  moyen: 10,
  carte: 14,
} as const;
