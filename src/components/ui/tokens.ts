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
  /**
   * BEIGE — une ligne déjà traitée, ou une zone qu'on met en évidence sans
   * l'alarmer. 1,22:1 sur le blanc : une nuance, pas une couleur.
   */
  beige: 'var(--dash-beige)',
  beigeBord: 'var(--dash-beige-bord)',
  beigeEncre: 'var(--dash-beige-encre)',
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

/**
 * LES DEUX PASTILLES D'OBJET — UNE couleur par NATURE d'objet, partout.
 *
 * ⚠️ RÈGLE (21/09/2026). La couleur d'un pavé d'initiales ou d'une icône ne
 * dit RIEN de l'objet : elle ne code ni l'étape, ni l'urgence, ni le score —
 * tout cela est déjà écrit sur la ligne, en toutes lettres. Une couleur qui
 * change sans rien signifier se lit comme une information, et on la cherche.
 *
 * Elle dit donc UNE seule chose : de quelle NATURE est la ligne.
 *   • une PERSONNE   → orange, partout et SANS EXCEPTION (Entretiens,
 *     Candidatures, Audit) ;
 *   • une CAMPAGNE   → bleu ciel et son éclair (Campagnes, Pilotage).
 *
 * Avant : un candidat était orange sur Entretiens quand il était en retard,
 * turquoise sinon, violet en attente de réservation, et marine dégradé sur
 * Candidatures. Quatre couleurs pour la même personne, selon l'écran.
 *
 * ⚠️ PORTÉE EXACTE. Sur la CARTE d'une campagne, les états « suspendue » et
 * « brouillon » gardent leurs teintes (jaune, gris) : elles distinguent trois
 * cartes côte à côte dans une même liste, ce qui est un autre problème. Seule
 * l'icône ACTIVE change — elle était verte, et le vert disait « conforme » là
 * où il ne signifiait rien de tel, pendant qu'il servait ailleurs à marquer
 * les candidats retenus.
 *
 * ⚠️ MESURE, et elle est basse. L'encre `#ff7f00` sur la pastille `#ffcb60`
 * donne **1,68:1**, et la pastille se détache de **1,42:1** du fond sand —
 * très en dessous des 3:1 d'un élément non textuel.
 *
 * Ce n'est tenable QUE parce que les initiales sont REDONDANTES : le nom
 * complet est à côté, en contraste AA, et aucune information ne dépend de
 * leur lecture. Ce sont les teintes demandées, et l'arbitrage appartient au
 * donneur d'ordre. Dans la même famille, si le plein AA était visé :
 * `#9a3412` donnerait 4,86:1 sur la même pastille.
 */
export const PASTILLE = {
  /** Le pavé d'initiales d'une PERSONNE. Une seule couleur, sans exception. */
  candidat: 'var(--dash-candidat)',
  /** L'encre des initiales. Jamais blanche : la pastille est claire. */
  candidatEncre: 'var(--dash-candidat-encre)',
  /** Le fond de l'icône d'une CAMPAGNE active. */
  campagne: 'var(--dash-sky)',
} as const;

/**
 * L'ÉTAT SÉLECTIONNÉ — une seule façon de le marquer dans tout le produit.
 *
 * Bordure teintée + fond tiède. C'est ce que porte une carte-compteur choisie
 * (`CounterRibbon`) ; la colonne de navigation prend EXACTEMENT les mêmes
 * valeurs, depuis ici, pour que « sélectionné » se reconnaisse d'un coup d'œil
 * qu'on soit dans un ruban ou dans la colonne.
 *
 * ⚠️ Jamais une ombre, jamais une bordure de plus de 1 px : le relief est
 * l'autre façon de marquer une sélection, et le produit n'en a pas.
 */
export const SELECTION = {
  /** Fond d'une entrée/carte choisie. */
  fond: 'var(--dash-warm)',
  /** Fond d'une entrée au repos. */
  fondRepos: 'transparent',
  /** Bordure d'une entrée choisie — la teinte de l'entrée, passée en argument. */
  bordureRepos: 'transparent',
} as const;

/** Rayons — trois, par taille d'objet. */
export const RAYON = {
  petit: 8,
  moyen: 10,
  carte: 14,
} as const;
