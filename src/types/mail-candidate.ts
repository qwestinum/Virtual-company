/**
 * Interface ÉTROITE du candidat pour le sous-système mail/scheduler
 * (composeCandidateMail / composeInterviewGuide + routes /api/mail-composer et
 * /api/scheduler + outreach IMAP). Ces agents n'ont besoin que de quelques
 * champs pour rédiger mails et briefs — pas du modèle d'analyse complet.
 *
 * Ségrégation d'interface (C6/6c-mail) : remplace l'usage de `CVAnalysisResult`.
 * Les frontières outreach (chat `manager-flow`, poller `imap/poller`) projettent
 * `CVApplication → MailCandidate` via `cvApplicationToMailCandidate`.
 */

import { z } from 'zod';

import type { CVApplication } from './cv-analysis';

export const MailCandidateSchema = z.object({
  candidateName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  score: z.number().int().min(0).max(100),
  /** accepted au scoring → mode 'invite', sinon 'reject'. */
  aboveThreshold: z.boolean(),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  justification: z.string().min(1),
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
    summary: narration.summary,
    strengths: narration.strengths,
    weaknesses: narration.weaknesses,
    justification: narration.justification,
  };
}
