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

// ─────────────────────────────────────────────────────────────────────────
// Sous-onglet « Rapport de campagne » (cf. docs/specs/reporting.md §3)
// ─────────────────────────────────────────────────────────────────────────

/** Volumes traités d'une campagne (carte + PDF). */
export type CampaignVolumes = {
  /** Candidatures analysées (= lignes candidate_analyses). */
  received: number;
  /** Retenues au screening (status accepted). */
  retained: number;
  /** Écartées au screening (status rejected). */
  rejected: number;
  /** Arbitrées manuellement (intervention humaine ≠ verdict IA). */
  arbitrated: number;
};

/**
 * Issue de campagne. Données disponibles : on distingue « au moins un
 * recrutement finalisé » du reste. La nuance abandonnée / sans suite
 * nécessiterait un motif saisi manuellement (non disponible) → regroupées.
 */
export type CampaignIssueKind = 'recruited' | 'no_hire';

/** Un envoi de rapport (traçabilité, lu du journal). */
export type CampaignReportSend = {
  at: string;
  to: string[];
  subject: string;
};

/**
 * Résumé d'une campagne clôturée — alimente la LISTE et la carte du
 * sous-onglet rapport de campagne. Volontairement plat.
 */
export type CampaignReportSummary = {
  campaignId: string;
  campaignName: string;
  jobTitle: string;
  /** Date de lancement (ISO ; repli createdAt). */
  launchedAt: string;
  /** Date de clôture (ISO ; repli updatedAt). */
  closedAt: string;
  durationDays: number;
  donneurOrdre: { label: string; role: string | null } | null;
  /** Id du donneur d'ordre (filtre dédié) ou null. */
  donneurOrdreId: string | null;
  siteLabel: string | null;
  volumes: CampaignVolumes;
  issue: CampaignIssueKind;
  recruitedCount: number;
  /** PDF en cache déjà généré (date ISO) ou null. */
  generatedAt: string | null;
  sends: CampaignReportSend[];
};

/** Performance d'un canal (réception) — proxy faute d'attribution diffusion. */
export type ChannelPerformance = {
  channelLabel: string;
  volume: number;
  retained: number;
  retentionRate: number;
  recruited: number;
};

/** Tranche de distribution des scores (histogramme). */
export type ScoreBucket = { label: string; count: number };

/**
 * Donnée d'analyse aplatie consommée par le calcul PUR du rapport. Les
 * champs dérivés du parcours (recruited/contacted/humanIntervention) sont
 * pré-calculés côté route (qui détient les signaux journal + HITL).
 */
export type CampaignAnalysisDatum = {
  status: CandidateStatus;
  totalScore: number;
  source: CVSource;
  humanIntervention: boolean;
  /** Parcours abouti à un recrutement (final retenu définitivement). */
  recruited: boolean;
  /** Le candidat a reçu une communication (invitation ou refus traité). */
  contacted: boolean;
};

/** Données complètes du rapport de campagne (alimente le PDF). */
export type CampaignReportData = {
  summary: CampaignReportSummary;
  performance: {
    retentionRate: number;
    /** Proxy : lancement → clôture (jours) quand recrutement, sinon null. */
    timeToHireDays: number | null;
    arbitrationRate: number;
    responseRate: number;
  };
  channels: ChannelPerformance[];
  topChannelLabels: string[];
  scoring: {
    distribution: ScoreBucket[];
    stdDev: number | null;
    average: number | null;
    arbitrationRate: number;
  };
  recommendations: string[];
  rgpd: {
    retentionMonths: number;
    plannedDeletionAt: string;
  };
  /** Volume faible (<5 candidatures) → statistiques peu significatives. */
  lowVolume: boolean;
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
