/**
 * Vocabulaire de la clôture — PUR, sans dépendance (lisible par la route du
 * journal, les signaux et les tests sans tirer le cœur serveur).
 */

/** Cause portée par le verdict d'un retenu non sélectionné à la clôture. */
export const NOT_SELECTED_CAUSE = 'not_selected_at_closure';

/** L'événement de clôture — un SEUL écrivain : `POST /api/campaigns/[id]/close`. */
export const CAMPAIGN_CLOSED_ACTION = 'campaign_closed';

/**
 * Les recrutés désignés par une clôture (identifiants d'analyse). Une clôture
 * peut en désigner PLUSIEURS depuis le 28/09/2026 (`hiredAnalysisIds`) ; une
 * clôture antérieure n'en portait qu'un (`hiredAnalysisId`) et reste lisible.
 */
export function hiredIdsOfClosure(payload: Record<string, unknown>): string[] {
  const many = payload.hiredAnalysisIds;
  if (Array.isArray(many)) {
    return many.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  }
  const one = payload.hiredAnalysisId;
  return typeof one === 'string' && one.trim() !== '' ? [one] : [];
}
