/**
 * Notifications métier in-app (toast agrégé + badges d'onglet).
 * Types PARTAGÉS serveur (route d'agrégation) ↔ client (toast, badges).
 */
import type { CandidateStage } from '@/lib/reporting/candidate-stage';

/**
 * Les signaux, par SURFACE d'affichage — ⚠️ TABLEAU, pas seulement une union
 * de types : une clé déclarée dans un type ne se compte pas à l'exécution, et
 * c'est ce qui permettait d'ajouter une clé sans jamais la calculer ni
 * l'afficher. Ici, toute clé ajoutée doit CHOISIR sa surface, et le test du
 * registre exige qu'elle ait aussi une définition qui la calcule.
 *
 * Deux surfaces, et la frontière n'est pas cosmétique (maquette v2 §A.2) :
 *
 *   - `dossier` — le signal parle d'un CANDIDAT qui attend. Il est déjà servi
 *     par les sections « À décider », « Propositions de refus » et
 *     « Entretiens » d'Aujourd'hui ; le répéter dans « À vérifier » ferait
 *     réclamer deux fois la même chose.
 *   - `verification` — le signal parle d'un RÉGLAGE ou d'une CAMPAGNE qui va
 *     poser problème. Jamais un candidat.
 */
export const BUSINESS_SIGNAL_SURFACES = {
  pending_validations_overdue: 'dossier',
  interviews_awaiting_decision: 'dossier',
  interviews_awaiting_pointing: 'dossier',
  availability_holidays_unblocked: 'verification',
  availability_meeting_location_missing: 'verification',
  /** Une offre APEC suspendue dont la fenêtre de republication se referme. */
  apec_republication_window_closing: 'verification',
  /** Une offre APEC toujours en ligne alors que la campagne est clôturée. */
  apec_offer_live_on_closed_campaign: 'verification',
  /**
   * La file de validation et les analyses ne racontent pas la même histoire,
   * DANS UN SENS COMME DANS L'AUTRE : une analyse qui attend sans fiche (donc
   * indécidable), ou une fiche ouverte sur un dossier qui n'attend plus (donc
   * un arbitrage fantôme). Rien ne relie les deux tables en base : la
   * divergence était silencieuse, et la première version de ce signal n'en
   * surveillait qu'un sens.
   *
   * `verification` et non `dossier` : ce n'est pas un candidat qui attend,
   * c'est le produit qui se contredit — et personne ne le réparera depuis une
   * file d'arbitrage.
   */
  validations_incoherentes: 'verification',
  /**
   * Une campagne active depuis plus d'une semaine n'a reçu AUCUNE
   * candidature. Ce n'est pas un dossier en souffrance, c'est un tuyau qui ne
   * coule pas : boîte non associée, annonce jamais diffusée, référence absente
   * de l'objet des mails.
   */
  campaign_without_candidates: 'verification',
} as const satisfies Record<string, 'dossier' | 'verification'>;

/** Clés des signaux. Étendre = ajouter une entrée ci-dessus ET sa définition. */
export type BusinessSignalKey = keyof typeof BUSINESS_SIGNAL_SURFACES;

/** Surface d'affichage d'un signal. */
export type BusinessSignalSurface =
  (typeof BUSINESS_SIGNAL_SURFACES)[BusinessSignalKey];

/**
 * Cible de navigation INTERNE (onglets du WorkspacePane — pas de route Next
 * dédiée, cohérent avec la navigation homogène par onglets).
 */
export type BusinessSignalTarget =
  | { tab: 'validations' }
  | { tab: 'candidatures'; stage: CandidateStage }
  /** Page Entretiens : `section` ouvre directement le bon onglet. */
  | { tab: 'entretiens'; section: 'a_pointer' | 'awaiting' }
  /**
   * Destination HORS workspace. Les Paramètres ne sont pas un onglet du
   * `WorkspacePane` mais une route Next à part entière : un signal qui porte
   * sur un RÉGLAGE (et non sur un dossier en attente) n'a pas d'onglet où
   * atterrir. On ne force donc pas une fausse valeur de `tab`.
   */
  | { route: string };

/** Un signal actif, prêt à afficher (message + CTA construits côté serveur). */
export type BusinessSignal = {
  key: BusinessSignalKey;
  /** Nombre d'éléments concernés (badge + message) — dossiers, ou agendas. */
  count: number;
  /**
   * Ancienneté du cas le plus ancien, en jours entiers. Vaut 0 pour un signal
   * qui ne VIEILLIT pas mais APPROCHE (un jour férié non bloqué) : le champ
   * n'est pas affiché, chaque signal composant lui-même son message.
   */
  oldestDays: number;
  /** Phrase complète du toast (français, singulier/pluriel géré). */
  message: string;
  /** Libellé du lien d'action. */
  ctaLabel: string;
  target: BusinessSignalTarget;
};

export type BusinessNotificationsResponse = {
  signals: BusinessSignal[];
  generatedAt: string;
};
