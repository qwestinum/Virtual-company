/**
 * Helpers d'AFFICHAGE partagés du module Reporting / Audit.
 *
 * CLIENT-SAFE : pas d'import serveur. Centralise les libellés métier
 * (verdicts, statuts, criticité) et le formatage de dates FR pour que la
 * vue détaillée (UI) et le PDF d'audit parlent EXACTEMENT le même langage.
 */

import type { CandidateAnalysisDetail } from '@/types/reporting';
import {
  CANDIDATE_STATUS_LABELS,
  SCORING_LEVELS,
  type CriterionDecision,
  type LlmDecision,
} from '@/types/scoring';

/** Libellé lisible d'un verdict LLM (audit = texte, pas d'emoji). */
export const LLM_DECISION_LABELS: Record<LlmDecision, string> = {
  satisfait: 'Satisfait',
  partiel: 'Partiel',
  non: 'Non satisfait',
  non_verifiable: 'Non vérifiable',
};

/** Couleur d'accent par verdict (cohérence vue détaillée / PDF). */
export const LLM_DECISION_COLORS: Record<LlmDecision, string> = {
  satisfait: '#15803d', // green-700
  partiel: '#b45309', // amber-700
  non: '#b91c1c', // red-700
  non_verifiable: '#57534e', // stone-600
};

/** Rang de criticité (rédhibitoire = 0, le plus critique en tête). */
const LEVEL_RANK: Record<(typeof SCORING_LEVELS)[number], number> =
  SCORING_LEVELS.reduce(
    (acc, level, idx) => {
      acc[level] = idx;
      return acc;
    },
    {} as Record<(typeof SCORING_LEVELS)[number], number>,
  );

/**
 * Trie un breakdown par criticité décroissante (critères durs en tête) —
 * ordre d'affichage canonique de l'audit, aligné sur le rapport markdown.
 */
export function sortByCriticality(
  breakdown: CriterionDecision[],
): CriterionDecision[] {
  return [...breakdown].sort(
    (a, b) => LEVEL_RANK[a.criticityLevel] - LEVEL_RANK[b.criticityLevel],
  );
}

/**
 * Date « inconnue » = invalide, vide, ou ≤ epoch Unix. Couvre `null`
 * (`new Date(null)` → epoch) et le sentinel `UNSET_COMPUTED_AT`
 * (`1970-01-01T00:00:00.000Z`) du scoring — pour ne jamais afficher
 * « 1er janvier 1970 » dans un rapport.
 */
function isUnknownDate(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) || t <= 0;
}

/** Date FR longue : « 15 juin 2026 ». Date inconnue → « — ». */
export function formatFrDate(iso: string): string {
  if (isUnknownDate(iso)) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Date+heure FR : « 15 juin 2026 à 14:32 ». Date inconnue → « — ». */
export function formatFrDateTime(iso: string): string {
  if (isUnknownDate(iso)) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Slug pour les noms de fichier PDF : « Jean Dupont » → « jean-dupont ».
 * ASCII-only, sans accents ni caractères spéciaux.
 */
export function slugForFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidat';
}

/**
 * Nom de fichier canonique du PDF d'audit candidat :
 * `ORQA-audit-candidat-[nom]-[date].pdf` (cf. docs/specs/reporting.md §5.3).
 * La date est passée explicitement (ISO) pour rester déterministe / testable.
 */
export function auditCandidatFileName(
  candidateName: string,
  generatedAtIso: string,
): string {
  const day = generatedAtIso.slice(0, 10); // YYYY-MM-DD
  return `ORQA-audit-candidat-${slugForFileName(candidateName)}-${day}.pdf`;
}

/** Évènement d'historique candidat (frise « Historique des actions »). */
export type CandidateHistoryEvent = {
  /** Horodatage ISO 8601. */
  at: string;
  label: string;
  detail?: string;
};

/**
 * Reconstruit la frise d'actions du candidat à partir des données
 * FIABLES de l'analyse (réception → scoring → décision). On évite une
 * corrélation fragile au journal (keyé par campagne, pas par candidat) :
 * mieux vaut une frise courte et exacte qu'une frise longue et douteuse.
 */
export function buildCandidateHistory(
  detail: CandidateAnalysisDetail,
): CandidateHistoryEvent[] {
  const { application } = detail;
  // Analyses historiques : `computedAt` n'était pas injecté (sentinel 1970).
  // On retombe sur `createdAt` (insertion en base ≈ moment de l'analyse).
  const computedAt = isUnknownDate(detail.computedAt)
    ? detail.createdAt
    : detail.computedAt;
  const events: CandidateHistoryEvent[] = [
    {
      at: detail.receivedAt,
      label: 'Réception de la candidature',
      detail: `Canal : ${application.candidate.source} · ${detail.fileName}`,
    },
    {
      at: computedAt,
      label: 'Analyse et scoring',
      detail: `Score ${detail.totalScore}/100 · grille ${application.scoringResult.criteriaVersion}`,
    },
    {
      at: computedAt,
      label: `Décision : ${CANDIDATE_STATUS_LABELS[detail.status]}`,
      detail: application.narration.justification,
    },
  ];
  return events;
}
