/**
 * LES ANNONCES PUBLIÉES, TOUS CANAUX — logique PURE.
 *
 * Deux sources qui ne se ressemblent pas : `job_postings` (l'Apec, avec un
 * statut distant qui est un CACHE daté) et `demo_job_posts` (l'annonce
 * générique, visible ou non). Les fondre en une seule ligne demande de dire ce
 * qu'on garde de chacune — d'où ce module, testable sans base.
 *
 * ⚠️ LE STATUT DISTANT EST UN CACHE, PAS UNE VÉRITÉ. Un consultant Apec peut
 * valider, un recruteur peut modifier sur apec.fr : ORQA ne l'apprend qu'en
 * demandant. Toute ligne porte donc `statutLuLe` — et un écran qui afficherait
 * l'état nu mentirait sur sa fraîcheur.
 *
 * ⚠️ J+30 N'EST PAS UNE DATE D'EXPIRATION QU'ORQA CONNAÎT. C'est la borne
 * au-delà de laquelle l'Apec REFUSE une republication (cf. le contrat du
 * connecteur). On calcule donc « combien de jours restent avant que republier
 * ne soit plus possible », et on le dit ainsi — pas « expire le ».
 */

/** Au-delà de 30 jours, l'Apec refuse la republication. */
export const JOURS_AVANT_REPUBLICATION_REFUSEE = 30;
/** En dessous, on prévient : le geste va devenir impossible. */
export const SEUIL_ALERTE_JOURS = 7;

export type EtatDiffusion = 'publiee' | 'suspendue' | 'a_republier' | 'brouillon';

export type LigneDiffusion = {
  /** Clé d'affichage — unique par (campagne, canal). */
  cle: string;
  campaignId: string;
  /** Intitulé lisible du canal, jamais son identifiant technique. */
  canal: string;
  etat: EtatDiffusion;
  /** Date de publication, ou `null` si l'annonce n'est pas partie. */
  publieeLe: string | null;
  /** Quand l'état a été LU chez le diffuseur. `null` = jamais interrogé. */
  statutLuLe: string | null;
  /**
   * Jours restants avant que republier ne soit plus possible. `null` quand la
   * notion ne s'applique pas (annonce générique, jamais publiée).
   */
  joursAvantRefus: number | null;
  /** Lien vers l'annonce chez le diffuseur, s'il y en a un. */
  url: string | null;
};

export const LIBELLE_CANAL: Record<string, string> = {
  apec: 'APEC',
  generique: 'Annonce générique',
};

export const LIBELLE_ETAT: Record<EtatDiffusion, string> = {
  publiee: 'Publiée',
  suspendue: 'Suspendue',
  a_republier: 'À republier',
  brouillon: 'Non diffusée',
};

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Jours ENTIERS écoulés depuis `iso`. `null` si la date est absente ou folle. */
export function joursDepuis(iso: string | null, maintenant: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((maintenant.getTime() - t) / JOUR_MS);
}

/**
 * Combien de jours restent avant que la republication soit refusée.
 * Négatif = la borne est dépassée ; on le rend tel quel, l'écran décide du mot.
 */
export function joursAvantRefus(
  publieeLe: string | null,
  maintenant: Date,
): number | null {
  const age = joursDepuis(publieeLe, maintenant);
  return age === null ? null : JOURS_AVANT_REPUBLICATION_REFUSEE - age;
}

export type EntreeApec = {
  campaignId: string;
  channel: string;
  remoteStatus: string | null;
  remoteStatusAt: string | null;
  remoteUrl: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
};

export type EntreeGenerique = {
  campaignId: string;
  isVisible: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

/** L'état d'une publication distante, à partir de son statut mis en cache. */
export function etatDepuisStatutDistant(
  statut: string | null,
  publieeLe: string | null,
  maintenant: Date,
): EtatDiffusion {
  if (statut === 'SUSPENDUE') return 'suspendue';
  if (statut !== 'PUBLIEE') return 'brouillon';
  const restant = joursAvantRefus(publieeLe, maintenant);
  // ⚠️ Une annonce dont la borne est dépassée reste PUBLIÉE chez le
  // diffuseur : elle n'est pas « expirée ». Ce qui change, c'est qu'on ne
  // pourra plus la republier — d'où « à republier », qui nomme le GESTE.
  return restant !== null && restant <= 0 ? 'a_republier' : 'publiee';
}

export function ligneApec(e: EntreeApec, maintenant: Date): LigneDiffusion {
  return {
    cle: `${e.campaignId}:${e.channel}`,
    campaignId: e.campaignId,
    canal: LIBELLE_CANAL[e.channel] ?? e.channel,
    etat: etatDepuisStatutDistant(e.remoteStatus, e.publishedAt, maintenant),
    publieeLe: e.publishedAt,
    statutLuLe: e.remoteStatusAt,
    joursAvantRefus: joursAvantRefus(e.publishedAt, maintenant),
    url: e.remoteUrl,
  };
}

export function ligneGenerique(e: EntreeGenerique): LigneDiffusion {
  return {
    cle: `${e.campaignId}:generique`,
    campaignId: e.campaignId,
    canal: LIBELLE_CANAL.generique!,
    etat: e.isVisible ? 'publiee' : 'brouillon',
    publieeLe: e.publishedAt,
    // L'annonce générique est servie par ORQA : son état n'est pas un cache,
    // il est exact à l'instant où on le lit.
    statutLuLe: null,
    // La borne des 30 jours est une règle de l'Apec, pas une règle générale.
    joursAvantRefus: null,
    url: e.isVisible ? `/jobs/${e.campaignId}` : null,
  };
}

/**
 * Ordre d'affichage : ce qui appelle un geste d'abord.
 *
 * « À republier », puis « Suspendue », puis les publiées de la plus ancienne à
 * la plus récente — une annonce vieille de 28 jours doit se voir avant une
 * publiée hier, parce que c'est elle qui va basculer.
 */
const RANG: Record<EtatDiffusion, number> = {
  a_republier: 0,
  suspendue: 1,
  publiee: 2,
  brouillon: 3,
};

export function trierDiffusion(lignes: readonly LigneDiffusion[]): LigneDiffusion[] {
  return [...lignes].sort((a, b) => {
    if (RANG[a.etat] !== RANG[b.etat]) return RANG[a.etat] - RANG[b.etat];
    const ra = a.joursAvantRefus ?? Number.POSITIVE_INFINITY;
    const rb = b.joursAvantRefus ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.cle.localeCompare(b.cle);
  });
}
