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
  /**
   * Signal 3 — entretien TERMINÉ depuis plus de N heures sans pointage
   * (réalisé / absent). En HEURES : un entretien de la veille au matin doit
   * remonter le lendemain, pas le surlendemain.
   */
  interviewPointingAgeHours: 24,
  /**
   * Onglet « En attente de réservation » — invitation partie depuis plus de
   * N jours sans créneau choisi. Sert le badge d'ancienneté, pas un toast.
   */
  invitationAgeDays: 5,
  /**
   * Signal 5 — offre APEC suspendue, republication encore possible pendant
   * moins de N jours. L'Apec ferme la fenêtre 30 jours après la PUBLICATION
   * (API_361) ; une semaine d'avance laisse le temps d'agir sans que le signal
   * devienne du bruit de fond.
   */
  apecRepublishWarningDays: 7,
  /**
   * Signal 9 — campagne ACTIVE depuis plus de N jours sans la moindre
   * candidature. 7 jours : assez pour qu'une diffusion ait eu le temps de
   * produire quelque chose, assez court pour qu'un flux mal branché se voie
   * dans la semaine plutôt qu'au bilan. En dessous, on accuserait à tort une
   * campagne qui vient d'être lancée un vendredi.
   */
  campaignWithoutCandidatesDays: 7,
} as const;
