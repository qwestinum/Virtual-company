/**
 * Types HITL — Validation suspendue (refus / acceptation candidats).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * `HitlConfig` = toggles par section (un par décision gateable). Pour l'instant
 * deux sections : mails de refus, mails d'acceptation. Extensible (diffusion,
 * shortlist…).
 */

import { z } from 'zod';

/** Décision proposée par le système pour un candidat. */
export const HitlDecisionSchema = z.enum(['accept', 'reject']);
export type HitlDecision = z.infer<typeof HitlDecisionSchema>;

/** Toggles de validation humaine par section. Défaut ON (cf. spec §2). */
export const HitlConfigSchema = z.object({
  rejectionMail: z.boolean(),
  acceptanceMail: z.boolean(),
});
export type HitlConfig = z.infer<typeof HitlConfigSchema>;

export const DEFAULT_HITL_CONFIG: HitlConfig = {
  rejectionMail: true,
  acceptanceMail: true,
};

/** La section HITL concernée par une décision donnée. */
export function hitlSectionForDecision(
  decision: HitlDecision,
): keyof HitlConfig {
  return decision === 'reject' ? 'rejectionMail' : 'acceptanceMail';
}

export const PendingValidationStatusSchema = z.enum(['pending', 'sent']);
export type PendingValidationStatus = z.infer<
  typeof PendingValidationStatusSchema
>;

/**
 * Une ligne de la file « Validation suspendue ». Persistée
 * (`pending_validations`) pour survivre au refresh. `decision` flippe au
 * Switcher ; `confirmed` passe à true au clic « Valider la décision »
 * (déverrouille la revue) ; `status: 'sent'` est terminal (mail envoyé).
 */
export const PendingValidationSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  candidateName: z.string().min(1),
  candidateEmail: z.string().nullable(),
  score: z.number().int().nullable(),
  decision: HitlDecisionSchema,
  cvArtifactId: z.string().nullable(),
  reportArtifactId: z.string().nullable(),
  mailDraftArtifactId: z.string().nullable(),
  confirmed: z.boolean(),
  status: PendingValidationStatusSchema,
  /** Snapshot nécessaire à l'envoi (MailCandidate, liens Cal.com…). */
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type PendingValidation = z.infer<typeof PendingValidationSchema>;
