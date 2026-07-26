/**
 * Seuils des notifications MÉTIER in-app (toasts + badges) — SEUL endroit où
 * vivent les « N jours ». Modifier une valeur ici suffit ; aucun seuil n'est
 * dupliqué dans les signaux, la route ou les composants.
 *
 * Périmètre : signaux d'ACTION HUMAINE attendue (un candidat qui attend).
 * Les signaux techniques (CV en échec, unmatched, retries) relèvent du
 * dashboard admin — chantier séparé.
 */
export const BUSINESS_NOTIFICATION_THRESHOLDS = {
  /** Signal 1 — validation grise en attente depuis plus de N jours. */
  pendingValidationAgeDays: 3,
  /** Signal 2 — entretien réalisé sans décision finale depuis plus de N jours. */
  interviewDecisionAgeDays: 2,
} as const;
