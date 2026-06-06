/**
 * Adapter TRANSITOIRE (C6 — 6a) : projette le nouveau `CVApplication` vers
 * l'ancienne forme `CVAnalysisResult`, pour basculer la route sur le pipeline
 * extraction/scoring/narration SANS toucher encore à l'UI ni au rapport.
 *
 * À SUPPRIMER en 6d, une fois l'UI et le rapport migrés nativement sur
 * `CVApplication`/`ScoreResult` (6b/6c).
 *
 * `skills` / `experienceYears` n'existent plus dans le nouveau modèle (le
 * breakdown par critère les remplace avec gain d'information). On les renvoie
 * vides ici — dégradation cosmétique assumée d'un seul commit (le rapport
 * affichera « 0 an(s) » jusqu'à 6b). `aboveThreshold` = statut `accepted`.
 */

import type { CVAnalysisResult, CVApplication } from '@/types/cv-analysis';

export function toLegacyCVResult(application: CVApplication): CVAnalysisResult {
  const { candidate, scoringResult, narration } = application;
  return {
    fileName: candidate.fileName,
    candidateName: candidate.fullName,
    email: candidate.email,
    phone: candidate.phone,
    skills: [], // retiré du modèle — remplacé par le breakdown (6b)
    experienceYears: 0, // retiré du modèle — transitoire
    score: scoringResult.totalScore,
    summary: narration.summary,
    strengths: narration.strengths,
    weaknesses: narration.weaknesses,
    justification: narration.justification,
    aboveThreshold: scoringResult.status === 'accepted',
  };
}
