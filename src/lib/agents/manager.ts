/**
 * Orchestration du Manager RH (Session 3).
 *
 * Point d'entrée serveur unique pour un tour de conversation Manager.
 * Coordonne :
 *   1. Classification d'intention (LLM, JSON strict).
 *   2. Application du seuil CLARIFICATION_THRESHOLD.
 *   3. Pré-recherche storage (stub Session 3 — vide).
 *   4. Réponse conversationnelle (LLM, JSON strict).
 *
 * Frontière critique : ce module est le SEUL endroit où chat ↔ FDP se
 * coordonnent. Les stores (chat-store, fdp-store) ne se connaissent pas
 * entre eux ; c'est l'API `runManagerTurn` qui les met en cohérence en
 * retournant un payload unique exploité par la route /api/manager/chat.
 */

import { chatComplete } from '@/lib/ai/provider';
import {
  searchExistingJobDescriptions,
  type JobDescription,
} from '@/lib/storage/job-descriptions';
import type { FDPInProgress } from '@/types/field-collection';
import {
  IntentClassificationSchema,
  type Intent,
  type IntentClassification,
} from '@/types/intent';
import {
  ManagerResponseSchema,
  type ManagerResponse,
} from '@/types/manager-response';

import {
  buildConversationalPrompt,
  buildIntentClassificationPrompt,
} from './manager-prompts';

export const MANAGER_AGENT_ID = 'agent.manager-rh';

/**
 * En dessous de ce seuil de confidence, la classification est marquée
 * comme nécessitant une clarification. Le prompt conversationnel est
 * alors instruit à proposer 2-3 chips canoniques (cf. manager-prompts).
 */
export const CLARIFICATION_THRESHOLD = 0.65;

export type ConversationTurn = {
  role: 'user' | 'manager';
  content: string;
};

export type ManagerTurnInput = {
  history: ConversationTurn[];
  fdp: FDPInProgress | null;
};

export type ManagerTurnMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};

export type ManagerTurnOutput = {
  classification: IntentClassification;
  response: ManagerResponse;
  preSearchHits: JobDescription[];
  campaignId: string | null;
  metrics: ManagerTurnMetrics;
};

export class ManagerError extends Error {
  constructor(
    public readonly code:
      | 'invalid_intent_classification'
      | 'invalid_response_json'
      | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'ManagerError';
  }
}

export function generateCampaignId(intent: Intent): string {
  const prefix = intent === 'out_of_campaign_task' ? 'TASK' : 'CAMP';
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
}

export async function runManagerTurn(
  input: ManagerTurnInput,
): Promise<ManagerTurnOutput> {
  const lastUserMessage =
    [...input.history].reverse().find((t) => t.role === 'user')?.content ?? '';

  const intentSystem = buildIntentClassificationPrompt();
  const conversation = input.history.map((t) => ({
    role: t.role === 'manager' ? ('assistant' as const) : ('user' as const),
    content: t.content,
  }));

  const intentCompletion = await chatComplete({
    jsonMode: true,
    temperature: 0.1,
    messages: [{ role: 'system', content: intentSystem }, ...conversation],
  });

  let classification: IntentClassification;
  try {
    classification = IntentClassificationSchema.parse(
      JSON.parse(intentCompletion.content),
    );
  } catch (err) {
    throw new ManagerError(
      'invalid_intent_classification',
      err instanceof Error ? err.message : 'Unparseable intent JSON.',
    );
  }

  if (classification.confidence < CLARIFICATION_THRESHOLD) {
    classification = { ...classification, needsClarification: true };
  }

  let preSearchHits: JobDescription[] = [];
  if (
    classification.intent === 'new_campaign' &&
    !classification.needsClarification &&
    lastUserMessage.length > 0
  ) {
    preSearchHits = await searchExistingJobDescriptions(lastUserMessage);
  }

  const conversationalSystem = buildConversationalPrompt({
    intent: classification.intent,
    confidence: classification.confidence,
    needsClarification: classification.needsClarification,
    fdp: input.fdp,
    preSearchHits,
  });

  const responseCompletion = await chatComplete({
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: conversationalSystem },
      ...conversation,
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(responseCompletion.content);
  } catch (err) {
    throw new ManagerError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable response JSON.',
    );
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.chips === null) delete r.chips;
    if (r.fieldExtractions === null) delete r.fieldExtractions;
  }
  let response: ManagerResponse;
  try {
    response = ManagerResponseSchema.parse(raw);
  } catch (err) {
    throw new ManagerError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Manager response shape invalid.',
    );
  }

  const campaignId =
    !input.fdp &&
    !classification.needsClarification &&
    (classification.intent === 'new_campaign' ||
      classification.intent === 'out_of_campaign_task')
      ? generateCampaignId(classification.intent)
      : (input.fdp?.campaignId ?? null);

  return {
    classification,
    response,
    preSearchHits,
    campaignId,
    metrics: {
      durationMs:
        intentCompletion.durationMs + responseCompletion.durationMs,
      tokensUsed:
        intentCompletion.usage.totalTokens +
        responseCompletion.usage.totalTokens,
      costEstimate:
        intentCompletion.costEstimate + responseCompletion.costEstimate,
    },
  };
}
