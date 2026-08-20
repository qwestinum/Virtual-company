/**
 * Notifications métier in-app (toast agrégé + badges d'onglet).
 * Types PARTAGÉS serveur (route d'agrégation) ↔ client (toast, badges).
 */
import type { CandidateStage } from '@/lib/reporting/candidate-stage';

/** Clés des signaux v1. V2 = étendre cette union + ajouter une définition. */
export type BusinessSignalKey =
  | 'pending_validations_overdue'
  | 'interviews_awaiting_decision'
  | 'interviews_awaiting_pointing';

/**
 * Cible de navigation INTERNE (onglets du WorkspacePane — pas de route Next
 * dédiée, cohérent avec la navigation homogène par onglets).
 */
export type BusinessSignalTarget =
  | { tab: 'validations' }
  | { tab: 'candidatures'; stage: CandidateStage }
  /** Page Entretiens : `section` ouvre directement le bon onglet. */
  | { tab: 'entretiens'; section: 'a_pointer' | 'awaiting' };

/** Un signal actif, prêt à afficher (message + CTA construits côté serveur). */
export type BusinessSignal = {
  key: BusinessSignalKey;
  /** Nombre de candidats concernés (badge + message). */
  count: number;
  /** Ancienneté du cas le plus ancien, en jours entiers. */
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
