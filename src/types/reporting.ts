/**
 * Types domaine du module Reporting (cf. docs/specs/reporting.md).
 *
 * Module CLIENT-SAFE : aucun import serveur (supabase, repos). Les
 * composants UI et les repos partagent ces shapes. Le mapping
 * row↔domaine vit dans `src/lib/db/repos/candidate-analyses.ts`.
 *
 * Périmètre actuel : sous-onglet Audit / Audit candidat. Les autres
 * sous-onglets (rapport de campagne, multi-campagnes) viendront enrichir
 * ce module.
 */

import type { CandidateJourney } from '@/lib/reporting/candidate-journey';
import type { CVApplication } from '@/types/cv-analysis';
import type { CVSource } from '@/types/cv-source';
import type { HitlConfig } from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

/**
 * Résumé d'une analyse candidat — alimente la LISTE de sélection de
 * l'audit (cartes / lignes filtrables). Volontairement plat et léger :
 * pas de `breakdown` ici (cf. `CandidateAnalysisDetail`).
 */
export type CandidateAnalysisSummary = {
  /** Identifiant de l'analyse = « numéro de candidature » dans l'audit. */
  id: string;
  /** Clé de corrélation avec les marqueurs de parcours du journal (fallback = id). */
  uid: string;
  /** Campagne de rattachement (null pour une analyse hors campagne). */
  campaignId: string | null;
  candidateName: string;
  candidateEmail: string | null;
  fileName: string;
  source: CVSource;
  /** Date de réception du CV (ISO 8601). */
  receivedAt: string;
  totalScore: number;
  status: CandidateStatus;
  /** Horodatage du scoring (ISO 8601). */
  computedAt: string;
  /** Horodatage d'insertion en base (ISO 8601). */
  createdAt: string;
  /**
   * Toggles HITL FIGÉS au moment de l'analyse (verdict provisoire vs
   * définitif). Repli sur `DEFAULT_HITL_CONFIG` pour les rows historiques.
   */
  hitlConfig: HitlConfig;
  /**
   * Parcours dérivé du journal (étape + intervention humaine). Présent
   * uniquement quand l'endpoint a enrichi le résumé ; absent sinon.
   */
  journey?: CandidateJourney;
};

/**
 * Analyse candidat COMPLÈTE — alimente la vue détaillée de l'audit
 * (critère par critère). Étend le résumé avec le `CVApplication` intégral
 * (profil + scoringResult.breakdown + narration).
 */
export type CandidateAnalysisDetail = CandidateAnalysisSummary & {
  application: CVApplication;
};

/** Filtres de sélection de l'audit candidat (combinés en ET logique). */
export type CandidateAnalysisFilters = {
  /** Recherche libre : nom, email, ou identifiant d'analyse. */
  search?: string;
  campaignId?: string;
  /** Verdict de screening (filtré en SQL). */
  status?: CandidateStatus;
  /** Borne basse de période sur `received_at` (ISO 8601). */
  from?: string;
  /** Borne haute de période sur `received_at` (ISO 8601). */
  to?: string;
  limit?: number;
};
