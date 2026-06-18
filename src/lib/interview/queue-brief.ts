/**
 * Mise en FILE d'un briefing d'entretien (juin 2026).
 *
 * À l'acceptation d'un CV, on GÉNÈRE la trame (LLM) mais on ne l'envoie PLUS :
 * on persiste un briefing `awaiting_booking`. Il ne sera délivré qu'à la
 * réservation Cal.com (webhook BOOKING_CREATED → `deliver-brief.ts`).
 *
 * Source unique appelée par /api/scheduler (chat + HITL) et le poller IMAP.
 */

import { composeInterviewGuide } from '@/lib/agents/server/mail-composer-execute';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { queuePendingBrief } from '@/lib/db/repos/interview-briefs';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { MailCandidate } from '@/types/mail-candidate';

export type QueueBriefResult =
  | { status: 'queued'; briefId: string }
  | { status: 'compose_failed'; error: string }
  | { status: 'persist_skipped'; error: string };

/**
 * Génère la trame d'entretien et met le briefing en attente de réservation.
 * `actor` distingue la source pour le journal (chat vs poller IMAP).
 */
export async function queueInterviewBrief(args: {
  /** CAMP-XXXX ou TASK-XXXX. */
  campaignId: string;
  jobTitle: string | null;
  candidate: MailCandidate;
  actor?: string;
  /** UID IMAP du message d'origine (traçabilité), si applicable. */
  uid?: string;
}): Promise<QueueBriefResult> {
  const isTask = args.campaignId.startsWith('TASK-');
  const journalCampaignId = isTask ? null : args.campaignId;
  const actor = args.actor ?? 'system';

  // 1. Trame d'entretien (LLM) — inchangée.
  let questions;
  try {
    const out = await composeInterviewGuide({
      candidate: args.candidate,
      jobTitle: args.jobTitle,
      campaignId: args.campaignId,
    });
    questions = out.guide.questions;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await appendJournalEntry({
      action: 'interview_brief_failed',
      actor,
      campaignId: journalCampaignId,
      payload: {
        stage: 'compose_guide',
        candidate: args.candidate.candidateName,
        uid: args.uid,
        error,
      },
    }).catch(() => {});
    return { status: 'compose_failed', error };
  }

  // 2. Persistance en attente de réservation (PAS d'envoi ici).
  try {
    const brief = await queuePendingBrief({
      ownerId: args.campaignId,
      jobTitle: args.jobTitle,
      candidate: args.candidate,
      questions,
    });
    await appendJournalEntry({
      action: 'interview_brief_queued',
      actor,
      campaignId: journalCampaignId,
      payload: {
        briefId: brief.id,
        candidate: args.candidate.candidateName,
        candidateEmail: brief.candidateEmail,
        uid: args.uid,
        taskId: isTask ? args.campaignId : undefined,
      },
    }).catch(() => {});
    return { status: 'queued', briefId: brief.id };
  } catch (err) {
    // Supabase absent (démo locale) ou erreur DB : on dégrade sans casser le
    // flux d'acceptation (le mail candidat, lui, est déjà parti).
    const error = err instanceof Error ? err.message : String(err);
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[interview-brief] queue persist failed', err);
    }
    return { status: 'persist_skipped', error };
  }
}
