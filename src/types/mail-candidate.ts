/**
 * Interface ÉTROITE du candidat pour le sous-système mail/scheduler
 * (buildInterviewMail / composeInterviewGuide + routes /api/mail-composer et
 * /api/scheduler + outreach IMAP). Ces agents n'ont besoin que de quelques
 * champs pour rédiger mails et briefs — pas du modèle d'analyse complet.
 *
 * Ségrégation d'interface (C6/6c-mail) : remplace l'usage de `CVAnalysisResult`.
 * Les frontières outreach (chat `manager-flow`, poller `imap/poller`) projettent
 * `CVApplication → MailCandidate` via `cvApplicationToMailCandidate`.
 */

import { z } from 'zod';

import { DecisionZoneSchema } from './hitl';
import { LlmDecisionSchema } from './scoring';
import type { CVApplication } from './cv-analysis';

export const MailCandidateSchema = z.object({
  candidateName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  score: z.number().int().min(0).max(100),
  /** accepted au scoring → mode 'invite', sinon 'reject'. */
  aboveThreshold: z.boolean(),
  /**
   * HITL 3 zones (lot 2) — zone de décision portée jusqu'au chemin IMAP
   * (`dispatchImapCandidateOutreach` route par ELLE, pas par `aboveThreshold` :
   * sinon impossible de distinguer `gray` de `auto_reject`). Optionnel : repli
   * sur `aboveThreshold` pour les projections antérieures.
   */
  decisionZone: DecisionZoneSchema.optional(),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  justification: z.string().min(1),
  /**
   * Candidature née d'une approche du module Sourcing : le briefing dit qui a
   * approché la personne et quand, à la place du paragraphe « repêché ».
   */
  sourcingApproach: z.object({ recruiterName: z.string().min(1), approachedAt: z.string() }).optional(),
  /**
   * Critère → verdict → citation, pour que le briefing montre SUR QUOI repose
   * le score. Optionnel : les briefings déjà en file n'en ont pas.
   */
  criteria: z
    .array(z.object({ label: z.string().min(1), decision: LlmDecisionSchema, quote: z.string() }))
    .optional(),
});
export type MailCandidate = z.infer<typeof MailCandidateSchema>;

/** Projection pure `CVApplication → MailCandidate` (frontière outreach). */
export function cvApplicationToMailCandidate(
  application: CVApplication,
): MailCandidate {
  const { candidate, scoringResult, narration } = application;
  return {
    candidateName: candidate.fullName,
    email: candidate.email,
    phone: candidate.phone,
    score: scoringResult.totalScore,
    aboveThreshold: scoringResult.status === 'accepted',
    decisionZone: scoringResult.decisionZone,
    summary: narration.summary,
    strengths: narration.strengths,
    weaknesses: narration.weaknesses,
    justification: narration.justification,
    criteria: scoringResult.breakdown.map((b) => ({
      label: b.criterionLabel,
      decision: b.llmDecision,
      quote: b.llmCVQuote,
    })),
  };
}
