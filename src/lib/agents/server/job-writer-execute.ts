/**
 * Exécution serveur du Job Writer (Session 4).
 *
 * Frontière critique : ce module importe `provider.ts` (server-only).
 * Il NE DOIT PAS être importé par le `registry`, sinon la chaîne
 * d'imports pollue le bundle client (`agents-store` consomme le
 * registry pour le rendu des cartes).
 *
 * Les routes API (/api/job-writer) appellent directement
 * `executeJobWriter` ; les snapshots client passent par
 * `jobWriterData` exporté depuis `contracts/job-writer.ts` (pure data).
 */

import {
  buildJobAdSystemPrompt,
  buildJobAdUserPrompt,
} from '@/lib/agents/job-writer-prompts';
import { chatComplete } from '@/lib/ai/provider';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  FDPInProgressSchema,
  type FDPInProgress,
} from '@/types/field-collection';
import { JobAdResultSchema, type JobAdResult } from '@/types/job-writer';
import {
  PublicationChannelSchema,
  type PublicationChannel,
} from '@/types/publication-channel';
import type { TaskInput, TaskOutput } from '@/types/task';

export class JobWriterError extends Error {
  constructor(
    public readonly code: 'invalid_payload' | 'invalid_response',
    message: string,
  ) {
    super(message);
    this.name = 'JobWriterError';
  }
}

export async function executeJobWriter(input: TaskInput): Promise<TaskOutput> {
  const fdpRaw = input.payload?.fdp;
  let fdp: FDPInProgress;
  try {
    fdp = FDPInProgressSchema.parse(fdpRaw);
  } catch (err) {
    throw new JobWriterError(
      'invalid_payload',
      err instanceof Error ? err.message : 'Invalid FDP payload.',
    );
  }

  // Channel optionnel — défaut "generic" (annonce multi-réseaux).
  // L'API route a déjà validé via PublicationChannelSchema ; on
  // re-vérifie ici pour ne pas faire confiance au payload brut.
  let channel: PublicationChannel = 'generic';
  const channelRaw = input.payload?.channel;
  if (channelRaw !== undefined) {
    const parsed = PublicationChannelSchema.safeParse(channelRaw);
    if (parsed.success) channel = parsed.data;
  }

  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.5,
    messages: [
      { role: 'system', content: buildJobAdSystemPrompt(channel) },
      { role: 'user', content: buildJobAdUserPrompt(fdp) },
    ],
  });

  let ad: JobAdResult;
  try {
    ad = JobAdResultSchema.parse(JSON.parse(completion.content));
  } catch (err) {
    throw new JobWriterError(
      'invalid_response',
      err instanceof Error ? err.message : 'Invalid Job Writer response.',
    );
  }

  // Session 6 v2 — trace dans le journal pour alimenter l'activity feed
  // du dashboard (« Annonce rédigée — <intitulé> (<canal>) »).
  // best-effort : si Supabase n'est pas configuré, on n'interrompt pas
  // l'exécution.
  try {
    const jobTitleVal = fdp.fields.job_title?.value;
    const jobTitle =
      typeof jobTitleVal === 'string' && jobTitleVal.trim().length > 0
        ? jobTitleVal.trim()
        : null;
    await appendJournalEntry({
      action: 'job_writer_rendered',
      actor: 'job_writer',
      campaignId: input.context.campaignId ?? null,
      payload: {
        jobTitle,
        channel,
        durationMs: completion.durationMs,
        tokens: completion.usage.totalTokens,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[job-writer] journal append failed', err);
    }
  }

  return {
    taskId: input.taskId,
    status: 'success',
    data: { ad },
    metrics: {
      durationMs: completion.durationMs,
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
    },
    nextAgents: [],
  };
}
