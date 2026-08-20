/**
 * Erreurs du module. Deux familles seulement :
 *   - configuration absente (le module n'a pas reçu ses ports) ;
 *   - échec base — porte le code Postgres pour que les appelants puissent
 *     distinguer une VIOLATION D'UNICITÉ (concurrence normale, attendue) d'une
 *     panne (à remonter).
 *
 * Les refus MÉTIER (créneau pris, lien révoqué, cible re-pointée) ne sont
 * jamais des exceptions : ce sont des verdicts typés dans le résultat. Une
 * exception signale un problème d'infrastructure, pas une course perdue.
 */

export class SchedulingNotConfiguredError extends Error {
  constructor() {
    super(
      'scheduling_not_configured: appelle configureScheduling({ supabase, ... }) au démarrage.',
    );
    this.name = 'SchedulingNotConfiguredError';
  }
}

export class SchedulingStoreError extends Error {
  readonly code: string | null;
  constructor(operation: string, message: string, code?: string | null) {
    super(`${operation}: ${message}`);
    this.name = 'SchedulingStoreError';
    this.code = code ?? null;
  }
}

/** Violation de contrainte d'unicité Postgres — le claim perdu, pas une panne. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

type PgError = { code?: string | null; message?: string; details?: string | null };

/**
 * Une violation d'unicité est-elle bien la course attendue sur le créneau ?
 *
 * Sans cette question, TOUTE violation d'unicité sur la table des réservations
 * serait rendue à l'appelant comme « créneau déjà pris » — un verdict faux, et
 * surtout muet : le vrai problème resterait invisible. Le cas s'est présenté
 * (le report du jeton de gestion heurtait son propre index d'unicité).
 *
 * Prudence délibérée dans les deux sens : on répond « oui » par défaut, pour ne
 * pas transformer une vraie course en erreur ; et « non » dès que Postgres
 * nomme une contrainte que l'on sait étrangère à la concurrence de créneau.
 */
export function isSlotClaimConflict(error: PgError | null): boolean {
  if (!isUniqueViolation(error)) return false;
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`;
  return !/manage_token/.test(text);
}
