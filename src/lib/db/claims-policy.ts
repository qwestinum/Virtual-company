/**
 * Politique PARTAGÉE des réservations d'effets de bord (audit C5/C6/I7).
 * PURE — testée unitairement, aucune dépendance.
 *
 * Deux mécanismes s'appuient dessus, avec le MÊME TTL (unifié volontairement,
 * pour éviter les états croisés bancals entre la réservation d'une validation
 * et le claim de son envoi) :
 *
 *  1. Claims DEUX PHASES (`imap_outreach_claims`, `calcom_webhook_events`) :
 *     posé AVANT l'effet de bord, CONFIRMÉ (`confirmed_at`) après succès.
 *     Le perdant d'un conflit distingue ainsi :
 *       - `already_confirmed` : l'effet a EU LIEU (prouvé) → ne jamais refaire ;
 *       - `in_flight`         : réservation jeune non confirmée → une autre
 *         passe est peut-être en train d'envoyer → DIFFÉRER, pas final ;
 *       - `stale`             : réservation périmée non confirmée → orpheline
 *         (crash entre claim et envoi) → REPRENABLE.
 *     Fenêtre résiduelle ASSUMÉE : crash entre l'envoi réussi et la pose de
 *     `confirmed_at` ⇒ la reprise après TTL renverra le mail (rare doublon).
 *     Trade-off projet : mieux un rare doublon qu'un candidat muet.
 *
 *  2. État `sending` de `pending_validations` : réservé avant envoi ; un
 *     `sending` plus vieux que le TTL (crash en plein envoi) redevient
 *     re-réservable — jamais un piège définitif.
 */

export const CLAIM_TTL_MINUTES = 5;
export const CLAIM_TTL_MS = CLAIM_TTL_MINUTES * 60_000;

export type ClaimConflictVerdict = 'already_confirmed' | 'in_flight' | 'stale';

/** Vrai si `ts` est plus vieux que le TTL (ou illisible — récupérable). */
export function isStaleTimestamp(ts: string | null, now: Date): boolean {
  if (!ts) return true;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return true;
  return t < now.getTime() - CLAIM_TTL_MS;
}

/** Verdict sur un claim EXISTANT que ce process n'a pas gagné. */
export function resolveClaimConflict(
  existing: { confirmedAt: string | null; createdAt: string | null },
  now: Date,
): ClaimConflictVerdict {
  if (existing.confirmedAt) return 'already_confirmed';
  return isStaleTimestamp(existing.createdAt, now) ? 'stale' : 'in_flight';
}
