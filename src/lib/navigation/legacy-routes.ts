/**
 * Anciennes adresses → leur nouvelle place. SOURCE UNIQUE, pure, testée.
 *
 * Règle de la refonte : **aucune adresse déjà servie ne rend 404**. Un lien
 * collé dans un compte rendu, un favori posé par un recruteur, une capture
 * d'écran d'une démonstration passée continuent de mener quelque part — et pas
 * « quelque part » au hasard : à l'écran qui porte la MÊME population, filtre
 * compris. Renvoyer `/validations` sur la liste complète des candidatures
 * serait tenir la promesse à la lettre et la trahir en pratique.
 *
 * Les pages de redirection LISENT ce tableau (elles ne recopient pas la
 * cible) : c'est ici, et nulle part ailleurs, qu'une destination se change.
 *
 * `why` n'est pas lu par la machine. Il est là pour la recette : ce tableau
 * est aussi le document de passation du lot.
 */

export const LEGACY_ROUTES = {
  '/app': {
    to: '/aujourdhui',
    why: "Le lobby des départements disparaît du chemin quotidien (lot 8 bis) : l'application s'ouvre sur ce qui attend une action, et le logo y ramène. Un lobby qu'on traverse sans le lire est un clic de plus, pas une orientation.",
  },
  '/rh': {
    to: '/aujourdhui',
    why: "Le portail du département RH n'avait qu'une porte — Recrutement — et celle-ci n'a plus de page d'accueil à elle. On atterrit directement sur le travail du jour.",
  },
  '/rh/recrutement': {
    to: '/aujourdhui',
    why: "Le workspace n'est plus une page unique à onglets : chaque entrée a son adresse. On atterrit sur ce qui attend une action.",
  },
  '/validations': {
    to: '/candidatures?statut=a_valider',
    why: "L'ancienne file d'arbitrage disparaît du premier niveau. Sa population, ce sont les candidatures à valider — elles se retrouvent sous leur puce, dans LA vue des candidatures.",
  },
  '/validations-vivier': {
    to: '/campagnes',
    why: "La file différée est supprimée (lot 4) : la décision se prend SUR PLACE, dans la recherche vivier d'une campagne. Les propositions qui y attendaient n'ont pas bougé d'un octet — elles ont été relocalisées et tracées au journal (`npm run relocate:vivier`), et réapparaissent sous leur campagne.",
  },
  '/reporting': {
    to: '/pilotage',
    why: 'Même contenu, autre nom de section : on pilote, on ne « reporte » pas.',
  },
  '/candidatures-apercu': {
    to: '/candidatures',
    why: "Aperçu jetable sur données fictives, marqué « À SUPPRIMER » dans son propre en-tête. Il mène à la vraie liste plutôt qu'au néant.",
  },
} as const satisfies Record<string, { to: string; why: string }>;

/** Les anciennes adresses, en type — une faute de frappe ne compile pas. */
export type LegacyPath = keyof typeof LEGACY_ROUTES;

/** Cible d'une ancienne adresse connue. Total : aucun repli à inventer. */
export function legacyTarget(from: LegacyPath): string {
  return LEGACY_ROUTES[from].to;
}

/**
 * Cible d'un chemin quelconque, ou `null` si ce n'est pas une ancienne
 * adresse. Comparaison EXACTE : `/validations/quelque-chose` n'est pas
 * `/validations`, et rediriger un chemin inconnu serait fabriquer une
 * destination.
 */
export function legacyRedirectFor(pathname: string): string | null {
  return pathname in LEGACY_ROUTES
    ? LEGACY_ROUTES[pathname as LegacyPath].to
    : null;
}
