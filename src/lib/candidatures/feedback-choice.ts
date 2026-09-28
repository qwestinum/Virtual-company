/**
 * Le choix de message posé AVEC une décision — schéma et règles PURES,
 * partagées par l'écran (bouton désarmé tant que le choix est incomplet) et
 * par les routes (qui REFUSENT une décision sans choix : c'est une règle
 * serveur, pas une convention d'écran). CLIENT-SAFE.
 */

import { z } from 'zod';

import { unresolvedPlaceholders } from '@/lib/candidatures/feedback-template';
import {
  SELF_FEEDBACK_CHANNELS,
  type FeedbackChoice,
  type FeedbackKind,
} from '@/types/candidate-feedback';
import type { FinalVerdict } from '@/types/verdict-comment';

export const MAX_FEEDBACK_SUBJECT = 300;
export const MAX_FEEDBACK_BODY = 8000;
export const MAX_FEEDBACK_NOTE = 200;

export const FeedbackChoiceSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('send'),
    subject: z.string().trim().min(1).max(MAX_FEEDBACK_SUBJECT),
    body: z.string().trim().min(1).max(MAX_FEEDBACK_BODY),
  }),
  z.object({
    mode: z.literal('self'),
    channel: z.enum(SELF_FEEDBACK_CHANNELS),
    note: z.string().trim().max(MAX_FEEDBACK_NOTE).nullable().optional(),
  }),
]) satisfies z.ZodType<FeedbackChoice>;

/** Le message annoncé par un verdict final. */
export function feedbackKindForVerdict(verdict: FinalVerdict): FeedbackKind {
  return verdict === 'validated' ? 'retenu' : 'non_retenu';
}

export type FeedbackChoiceRefusal =
  | 'no_candidate_email'
  | 'comment_in_message'
  | 'unresolved_placeholders';

export const FEEDBACK_REFUSAL_MESSAGES: Record<FeedbackChoiceRefusal | 'feedback_required', string> = {
  feedback_required:
    'Choisissez comment le candidat est informé : envoyer le message, ou le prévenir vous-même.',
  no_candidate_email:
    'Aucune adresse n’est connue pour ce candidat : prévenez-le vous-même et indiquez par quel canal.',
  comment_in_message:
    'Le message reprend votre commentaire interne. Il ne part jamais au candidat : retirez-le du message.',
  unresolved_placeholders:
    'Le message contient encore une variable entre crochets. Complétez-la ou retirez-la avant d’envoyer.',
};

/** Taille minimale d'un commentaire pour que sa reprise soit détectée. */
const MIN_COMMENT_TO_DETECT = 12;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Le corps reprend-il le commentaire interne ? Ceinture côté serveur : le
 * gabarit n'a pas accès au commentaire, mais un recruteur pourrait le coller.
 * Un commentaire très court (« OK ») n'est pas détectable sans faux positifs.
 */
export function bodyQuotesComment(body: string, comment: string | null | undefined): boolean {
  const c = normalize(comment ?? '');
  if (c.length < MIN_COMMENT_TO_DETECT) return false;
  return normalize(body).includes(c);
}

/**
 * Contrôles du choix AVANT toute écriture. `null` = recevable. Appelé par les
 * routes avant de poser la décision : un choix irrecevable ne laisse jamais
 * une décision posée sans message.
 */
export function checkFeedbackChoice(
  choice: FeedbackChoice,
  ctx: { candidateEmail: string | null; comment?: string | null },
): FeedbackChoiceRefusal | null {
  if (choice.mode === 'self') return null;
  if (!ctx.candidateEmail) return 'no_candidate_email';
  if (bodyQuotesComment(choice.body, ctx.comment)) return 'comment_in_message';
  if (
    unresolvedPlaceholders(choice.body).length > 0 ||
    unresolvedPlaceholders(choice.subject).length > 0
  ) {
    return 'unresolved_placeholders';
  }
  return null;
}
