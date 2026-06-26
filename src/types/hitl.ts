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

/**
 * Zone de décision FIGÉE au moment du scoring (modèle 3 zones HITL). En lot 1,
 * le scoring est encore en seuil unique : seules `auto_reject`/`auto_accept`
 * sont posées. `gray` est réservée au lot 2 (deux poignées) — le champ
 * l'accueille déjà, sans nouvelle migration. `null` = ligne antérieure au
 * modèle 3 zones (frontière nette avant/après lot 1, jamais reconstruite).
 */
export const DecisionZoneSchema = z.enum(['auto_reject', 'gray', 'auto_accept']);
export type DecisionZone = z.infer<typeof DecisionZoneSchema>;

/**
 * Type d'acteur ayant tranché le statut FINAL. `auto` = décision système (pas
 * d'identité). `user` = tranché par un humain (identité capturée). `null` =
 * ligne historique (non capturé, jamais backfillé).
 */
export const DecidedBySchema = z.enum(['auto', 'user']);
export type DecidedBy = z.infer<typeof DecidedBySchema>;

/**
 * Identité du valideur humain — renseignée UNIQUEMENT quand `decidedBy='user'`.
 * `userId` = id stable du compte Supabase Auth (pas de FK : la trace d'audit
 * survit à la suppression du compte). `email` = snapshot lisible au moment de
 * la décision (auto-suffisant pour le reporting). Source = session serveur
 * (`getApiUser`), jamais le payload client.
 */
export type HumanDecider = {
  userId: string;
  email: string | null;
};

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
  /**
   * Type d'acteur ayant confirmé (lot 1 : toujours `user` à la confirmation,
   * `null` à l'enqueue). Capture « système vs humain » pour le reporting.
   */
  decidedBy: DecidedBySchema.nullable(),
  /**
   * Identité du valideur humain — id + email snapshot, depuis la session
   * serveur. `null` tant que personne n'a confirmé (enqueue) ou chemin auto.
   */
  decidedByUser: z
    .object({ userId: z.string(), email: z.string().nullable() })
    .nullable(),
});
export type PendingValidation = z.infer<typeof PendingValidationSchema>;
