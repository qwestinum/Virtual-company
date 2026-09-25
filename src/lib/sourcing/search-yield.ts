/**
 * Le rendement d'une recherche : ce que le moteur a renvoyé, et où c'est passé.
 * PUR. Spec : docs/specs/sourcing.md §18.
 *
 * ⚠️ « 99 profils examinés » (25/09/2026). La fin de liste affichait le nombre
 * de résultats RENVOYÉS comme s'ils avaient tous été montrés. Le 24/09, Exa a
 * rendu deux réponses dont 89 résultats sur 100 étaient inexploitables : le
 * recruteur en voyait 10, l'écran lui disait « 99 examinés — modifiez la
 * requête », et l'envoyait corriger une requête qui n'avait rien de fautif.
 * On écrit désormais le compte entier, et une réponse anormale est DITE comme
 * telle — avec le bon geste : relancer la MÊME requête (les profils déjà vus
 * sont écartés, rien ne revient deux fois).
 */

/** Pourquoi un résultat du moteur n'a pas pu devenir un profil. */
export type UnusableBreakdown = {
  /** Réponse mal formée : un champ attendu manque ou a changé de type. */
  malformed: number;
  /** L'adresse n'est pas celle d'un profil (page d'entreprise, publication…). */
  notAProfile: number;
  /** Profil sans nom lisible. */
  noName: number;
};

export type SearchYield = {
  /** Résultats renvoyés par le moteur. */
  returned: number;
  /** Résultats inexploitables (toutes causes). */
  unusable: number;
  /** Déjà vus, déclinés, opposés ou en double dans la réponse. */
  hidden: number;
  /** Profils gardés (à examiner + réserve). */
  kept: number;
};

/**
 * Au-delà de cette part d'inexploitables, la réponse est anormale. Le régime
 * normal mesuré est de 0 à 3 % (pages d'entreprise, publications) ; l'incident
 * du 24/09 était à 89 %.
 */
export const ANOMALOUS_UNUSABLE_SHARE = 0.3;
/** Sous ce volume, une proportion ne veut rien dire. */
const MIN_RETURNED_FOR_ANOMALY = 10;

export function isAnomalousYield(y: SearchYield): boolean {
  return y.returned >= MIN_RETURNED_FOR_ANOMALY && y.unusable / y.returned >= ANOMALOUS_UNUSABLE_SHARE;
}

const n = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** « 99 profils renvoyés par le moteur, 89 illisibles, 10 affichés. » */
export function describeSearchYield(y: SearchYield): string {
  const parts = [n(y.returned, 'profil renvoyé par le moteur', 'profils renvoyés par le moteur')];
  if (y.unusable > 0) parts.push(n(y.unusable, 'illisible', 'illisibles'));
  if (y.hidden > 0) parts.push(n(y.hidden, 'déjà vu ou écarté', 'déjà vus ou écartés'));
  parts.push(n(y.kept, 'affiché', 'affichés'));
  return `${parts.join(', ')}.`;
}

export const ANOMALY_ADVICE =
  'Le moteur a mal répondu à cette recherche : relancez la même requête — les profils déjà vus ne reviendront pas.';

/**
 * Relit le bilan d'une recherche dans l'entrée de journal `sourcing_search_run`.
 * `null` si l'entrée manque ou ne porte pas les compteurs : on ne devine pas.
 */
export function yieldFromRunPayload(
  payload: Record<string, unknown> | null | undefined,
  kept: number,
): SearchYield | null {
  if (!payload) return null;
  const returned = payload.returned;
  const unusable = payload.unusable;
  if (typeof returned !== 'number' || typeof unusable !== 'number') return null;
  const s = (payload.skipped ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const hidden = num(s.alreadySeen) + num(s.excluded) + num(s.opposed) + num(s.duplicates);
  return { returned, unusable, hidden, kept };
}

/**
 * Les champs fautifs d'un résultat mal formé, sans aucune VALEUR : le chemin et
 * la nature de l'écart (« url: invalid_type »). Bornés, dédoublonnés — assez
 * pour savoir d'où vient une panne, rien qui puisse porter une personne.
 */
export function malformedFieldLabels(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>,
): string[] {
  return issues.map((i) => `${i.path.map((p) => (typeof p === 'number' ? '#' : String(p))).join('.') || '(racine)'}: ${i.code}`);
}

export const MAX_MALFORMED_FIELDS = 10;
