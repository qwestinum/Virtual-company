/**
 * Helpers PURS du champ « type de contrat » (multi-valeur + saisie libre).
 *
 * Le champ FDP `contract_type` passe de valeur UNIQUE (string enum) à une LISTE
 * (`string[]`) : plusieurs contrats acceptés pour un même poste, plus la saisie
 * libre. Ce module centralise lecture, canonicalisation et affichage pour TOUS
 * les consommateurs (éditeur, rendu FDP, archive, Manager). Un seul endroit :
 *   - tolère la RÉTRO-COMPAT (ancienne valeur unique `string` → liste à 1) ;
 *   - DÉDUPLIQUE insensible à la casse/aux accents (jamais `["CDI","cdi"]`) ;
 *   - CANONICALISE une saisie libre vers l'option prédéfinie équivalente.
 *
 * Pur et déterministe (testé). Aucune dépendance React/DOM/réseau.
 */

import { ContractTypeSchema } from '@/types/field-collection';

/** Options prédéfinies du menu (source unique : l'enum). */
export const CONTRACT_TYPE_OPTIONS: readonly string[] = ContractTypeSchema.options;

/** Clé de comparaison insensible casse + accents (dédup + canonicalisation). */
function foldKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Lit une valeur de champ contrat en LISTE, tolérante :
 *   - `string[]`            → nettoyée (trim, non vides) ;
 *   - `string` (legacy)     → `[string]` (RÉTRO-COMPAT mono-valeur) ;
 *   - `null`/`undefined`/'' → `[]`.
 * Ne SPLIT jamais une `string` : une valeur legacy = UN seul contrat (on ne
 * fabrique pas de faux multi à partir d'une virgule).
 */
export function asContractList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? [t] : [];
  }
  return [];
}

/** Une valeur correspond-elle (casse/accents ignorés) à une option prédéfinie ? */
export function isPredefinedContract(value: string): boolean {
  const k = foldKey(value);
  return CONTRACT_TYPE_OPTIONS.some((o) => foldKey(o) === k);
}

/**
 * Canonicalise une saisie : si elle correspond (casse/accents ignorés) à une
 * option prédéfinie, renvoie la FORME canonique de l'option ; sinon le texte
 * trimé tel quel (saisie libre conservée). '' si vide.
 */
export function canonicalizeContract(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const k = foldKey(trimmed);
  return CONTRACT_TYPE_OPTIONS.find((o) => foldKey(o) === k) ?? trimmed;
}

/** Une liste contient-elle déjà ce contrat (casse/accents ignorés) ? */
export function hasContract(list: string[], value: string): boolean {
  const k = foldKey(value);
  return list.some((e) => foldKey(e) === k);
}

/**
 * Ajoute une saisie à une liste : canonicalise + DÉDUPLIQUE. Renvoie la liste
 * INCHANGÉE (même référence) si l'entrée est vide ou déjà présente — un « cdi »
 * tapé en libre fusionne sur l'option `CDI`, jamais `["CDI","cdi"]`.
 */
export function addContract(list: string[], raw: string): string[] {
  const v = canonicalizeContract(raw);
  if (!v || hasContract(list, v)) return list;
  return [...list, v];
}

/** Bascule une option dans la liste (ajoute si absente, retire si présente). */
export function toggleContract(list: string[], option: string): string[] {
  const k = foldKey(option);
  return hasContract(list, option)
    ? list.filter((e) => foldKey(e) !== k)
    : addContract(list, option);
}

/** Normalise une liste entière (canonicalise chaque entrée + dédup, ordre préservé). */
export function normalizeContractList(values: string[]): string[] {
  let out: string[] = [];
  for (const v of values) out = addContract(out, v);
  return out;
}

/** Affichage JOINT (« CDI, CDD »), depuis n'importe quelle forme de valeur. '' si vide. */
export function joinContracts(value: unknown): string {
  return asContractList(value).join(', ');
}
