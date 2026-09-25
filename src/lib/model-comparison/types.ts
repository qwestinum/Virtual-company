/**
 * Comparaison de modèles pour l'analyse des CV — types partagés.
 * Protocole : docs/ops/comparaison-modeles-scoring.md.
 *
 * Un « bras » = un modèle rejoué sur un ensemble de CV, dans son propre
 * processus. Ce qu'il écrit par CV est un `ArmRecord` : des décisions, des
 * chiffres, et — pour la relecture à la main seulement — les citations et
 * justifications, qui ne sortent jamais dans le rapport.
 */
import type { DecisionZone } from '@/types/hitl';
import type { LlmDecision } from '@/types/scoring';

export type ArmName = 'reference' | 'noise' | 'candidate';

/** Trois zones pour la matrice : l'ancienne `auto_reject` se range avec le refus. */
export type ZoneBucket = 'accept' | 'gray' | 'reject';

export type ArmVerdict = {
  criterionId: string;
  label: string;
  level: string;
  decision: LlmDecision;
  /** Citation du CV — relecture manuelle seulement, JAMAIS dans le rapport. */
  quote: string;
  /** Justification — relecture manuelle seulement, JAMAIS dans le rapport. */
  justification: string;
  quoteFound: boolean | null;
  /**
   * Verdict POSITIF du modèle rétrogradé par la garde « aucun oui sans
   * preuve » (citation absente ou introuvable). Absent des enregistrements
   * antérieurs à la garde.
   */
  evidenceDowngrade?: { from: 'satisfait' | 'partiel'; reason: 'missing_quote' | 'quote_not_found' };
};

export type ArmSuccess = {
  ok: true;
  analysisId: string;
  campaignId: string;
  score: number;
  zone: DecisionZone;
  verdicts: ArmVerdict[];
  /** Critères rédhibitoires en échec (identifiants). */
  knockoutsFailed: string[];
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Modèles renvoyés par l'API pour ce CV. */
  models: string[];
  /**
   * Phases DÉGRADABLES qui ont échoué (sortie invalide après réessais) : un
   * modèle qui rate le relevé de faits juge ensuite sans lui. Absent des
   * enregistrements antérieurs à ce champ.
   */
  degradedPhases?: ('candidate' | 'ledger' | 'narration')[];
  /**
   * Relevé de faits vu par les verdicts, aplati en une liste de faits —
   * DIAGNOSTIC seulement (reste dans le répertoire de sortie, jamais dans le
   * rapport). Absent des enregistrements antérieurs.
   */
  ledgerFacts?: string[];
};

export type ArmFailureKind = 'analysis_unavailable' | 'unproven_negative' | 'transport' | 'other';

export type ArmFailure = {
  ok: false;
  analysisId: string;
  campaignId: string;
  kind: ArmFailureKind;
  /** Message technique, sans contenu de CV. */
  message: string;
  durationMs: number;
};

export type ArmRecord = ArmSuccess | ArmFailure;

/** Ce que le processus principal remet à chaque bras. Contient des CV : reste dans le répertoire de sortie. */
export type ReplayItem = {
  analysisId: string;
  campaignId: string;
  cvText: string;
  fileName: string;
  receivedAt: string;
  thresholdLow: number;
  thresholdHigh: number;
};
