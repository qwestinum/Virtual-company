/**
 * Vocabulaire de la clôture — PUR, sans dépendance (lisible par la route du
 * journal, les signaux et les tests sans tirer le cœur serveur).
 */

/** Cause portée par le verdict d'un retenu non sélectionné à la clôture. */
export const NOT_SELECTED_CAUSE = 'not_selected_at_closure';

/** L'événement de clôture — un SEUL écrivain : `POST /api/campaigns/[id]/close`. */
export const CAMPAIGN_CLOSED_ACTION = 'campaign_closed';
