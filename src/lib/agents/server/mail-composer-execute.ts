/**
 * Exécution serveur du Mail Composer (Session 5 round 4).
 *
 * Server-only — utilise le provider OpenAI (clé OPENAI_API_KEY).
 * Le LLM produit le subject+html. L'envoi réel via Resend est géré
 * par le caller (route API) qui orchestre :
 *   1. composer (ici) → produit subject + html
 *   2. sendEmail (lib/email/client.ts) → POST Resend
 *   3. insertArtifactMeta (lib/db/repos/artifacts.ts) → trace
 */

import { z } from 'zod';

import { chatComplete } from '@/lib/ai/provider';
import {
  buildInterviewGuideSystemPrompt,
  buildInterviewGuideUserPrompt,
  buildMailComposerSystemPrompt,
  buildMailComposerUserPrompt,
  type MailComposerContext,
} from '@/lib/agents/mail-composer-prompts';
import type { MailCandidate } from '@/types/mail-candidate';

export class MailComposerError extends Error {
  constructor(
    public readonly code:
      | 'invalid_response_json'
      | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'MailComposerError';
  }
}

const MailResponseSchema = z.object({
  subject: z.string().min(1).max(120),
  html: z.string().min(10),
});
export type ComposedMail = z.infer<typeof MailResponseSchema>;

export async function composeCandidateMail(
  ctx: MailComposerContext,
): Promise<{ mail: ComposedMail; metrics: { tokensUsed: number; costEstimate: number; durationMs: number } }> {
  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildMailComposerSystemPrompt() },
      { role: 'user', content: buildMailComposerUserPrompt(ctx) },
    ],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(completion.content);
  } catch (err) {
    throw new MailComposerError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable response JSON.',
    );
  }
  let mail: ComposedMail;
  try {
    mail = MailResponseSchema.parse(raw);
  } catch (err) {
    throw new MailComposerError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Invalid mail shape.',
    );
  }
  return {
    mail,
    metrics: {
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
      durationMs: completion.durationMs,
    },
  };
}

const InterviewGuideSchema = z.object({
  questions: z
    .array(
      z.object({
        theme: z.string().min(1).max(80),
        question: z.string().min(1).max(400),
      }),
    )
    .min(6)
    .max(8),
});
export type InterviewGuide = z.infer<typeof InterviewGuideSchema>;

export async function composeInterviewGuide(args: {
  candidate: MailCandidate;
  jobTitle: string | null;
  campaignId: string;
}): Promise<{ guide: InterviewGuide; metrics: { tokensUsed: number; costEstimate: number; durationMs: number } }> {
  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildInterviewGuideSystemPrompt() },
      { role: 'user', content: buildInterviewGuideUserPrompt(args) },
    ],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(completion.content);
  } catch (err) {
    throw new MailComposerError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable response JSON.',
    );
  }
  let guide: InterviewGuide;
  try {
    guide = InterviewGuideSchema.parse(raw);
  } catch (err) {
    throw new MailComposerError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Invalid guide shape.',
    );
  }
  return {
    guide,
    metrics: {
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
      durationMs: completion.durationMs,
    },
  };
}
