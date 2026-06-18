/**
 * Délivrance d'un briefing d'entretien À LA RÉSERVATION Cal.com (juin 2026).
 *
 * Appelé par le webhook BOOKING_CREATED, APRÈS vérification de signature et
 * réservation d'idempotence. Résout le briefing en attente par EMAIL ; à
 * défaut, régénère la trame à la volée (repli). Délivre par MAIL aux adresses
 * de SYNTHÈSE (jamais l'email du payload), CV en pièce jointe depuis le vivier.
 *
 * Canal agenda : aucun — Cal.com pose lui-même le RDV dans l'agenda du
 * recruteur (calendrier connecté). ORQA n'assure que le canal mail confidentiel.
 */

import {
  buildInterviewBriefMail,
  buildUnmatchedBookingMail,
} from '@/lib/agents/server/interview-brief-mail';
import { composeInterviewGuide } from '@/lib/agents/server/mail-composer-execute';
import { getLatestAnalysisByEmail } from '@/lib/db/repos/candidate-analyses';
import {
  createScheduledBrief,
  getPendingBriefByEmail,
  markBriefScheduled,
  type BookingDelivery,
} from '@/lib/db/repos/interview-briefs';
import { getVivierCandidateByEmail } from '@/lib/db/repos/vivier';
import { getSynthesisEmails } from '@/lib/email/addresses';
import {
  sendEmail,
  type EmailAttachment,
} from '@/lib/email/client';
import { downloadArtifact } from '@/lib/storage/blob';
import { normalizeEmail } from '@/lib/vivier/candidates';
import type { InterviewQuestion } from '@/types/interview-brief';
import {
  cvApplicationToMailCandidate,
  type MailCandidate,
} from '@/types/mail-candidate';

export type DeliverBriefInput = {
  bookingUid: string;
  attendeeEmail: string;
  attendeeName: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
};

export type DeliverBriefResult = {
  /** true = traité (livré ou non-retrouvé géré) — le claim d'idempotence est conservé. */
  ok: boolean;
  status:
    | 'delivered' // briefing livré aux adresses de synthèse
    | 'regenerated_delivered' // repli : trame régénérée puis livrée
    | 'unmatched' // email inconnu → notification de repli envoyée
    | 'no_recipient' // aucune adresse de synthèse configurée
    | 'send_failed'; // échec d'envoi Resend (transitoire)
  /** true = échec TRANSITOIRE → l'appelant relâche le claim pour autoriser un rejeu. */
  retryable: boolean;
  messageId?: string | null;
  error?: string;
};

/** Charge le CV du candidat (vivier, par email) en pièce jointe base64. */
async function loadCvAttachment(
  email: string,
): Promise<EmailAttachment | null> {
  try {
    const candidate = await getVivierCandidateByEmail(normalizeEmail(email));
    if (!candidate?.cvPath) return null;
    const buf = await downloadArtifact(candidate.cvPath);
    if (!buf) return null;
    const filename = candidate.cvFileName ?? 'CV.pdf';
    return { filename, content: buf.toString('base64') };
  } catch {
    // Dégradation douce : on livre le briefing sans PJ (mention dans le corps).
    return null;
  }
}

async function sendBrief(args: {
  recipients: string[];
  candidate: MailCandidate;
  jobTitle: string | null;
  ownerLabel: string;
  questions: InterviewQuestion[];
  input: DeliverBriefInput;
}): Promise<{ ok: boolean; messageId: string | null; error?: string }> {
  const attachment = await loadCvAttachment(args.input.attendeeEmail);
  const { subject, html } = buildInterviewBriefMail({
    candidate: args.candidate,
    jobTitle: args.jobTitle,
    ownerLabel: args.ownerLabel,
    questions: args.questions,
    booking: {
      startAt: args.input.startTime,
      endAt: args.input.endTime,
      location: args.input.location,
    },
    cvAttached: attachment !== null,
  });
  return sendEmail({
    to: args.recipients,
    subject,
    html,
    ...(attachment ? { attachments: [attachment] } : {}),
  });
}

export async function deliverBriefForBooking(
  input: DeliverBriefInput,
): Promise<DeliverBriefResult> {
  const recipients = await getSynthesisEmails();
  if (recipients.length === 0) {
    return { ok: false, status: 'no_recipient', retryable: false };
  }

  const pending = await getPendingBriefByEmail(input.attendeeEmail);
  const delivery = (messageId: string | null): BookingDelivery => ({
    bookingUid: input.bookingUid,
    interviewStartAt: input.startTime,
    interviewEndAt: input.endTime,
    interviewLocation: input.location,
    deliveredMessageId: messageId,
  });

  // ── Cas nominal : un briefing était en attente ─────────────────────
  if (pending) {
    const ownerLabel = pending.campaignId ?? pending.taskId ?? 'la campagne';
    const send = await sendBrief({
      recipients,
      candidate: pending.candidate,
      jobTitle: pending.jobTitle,
      ownerLabel,
      questions: pending.questions,
      input,
    });
    if (!send.ok) {
      return {
        ok: false,
        status: 'send_failed',
        retryable: true,
        error: send.error,
      };
    }
    await markBriefScheduled(pending.id, delivery(send.messageId));
    return {
      ok: true,
      status: 'delivered',
      retryable: false,
      messageId: send.messageId,
    };
  }

  // ── Repli : pas de briefing en file → régénération à la volée ──────
  const analysis = await getLatestAnalysisByEmail(input.attendeeEmail);
  if (!analysis) {
    // Candidat non retrouvé : on NOTIFIE la synthèse (l'info ne se perd jamais).
    const notice = buildUnmatchedBookingMail({
      attendeeEmail: input.attendeeEmail,
      attendeeName: input.attendeeName,
      startAt: input.startTime,
    });
    await sendEmail({ to: recipients, subject: notice.subject, html: notice.html });
    return { ok: true, status: 'unmatched', retryable: false };
  }

  const candidate = cvApplicationToMailCandidate(analysis.application);
  let questions: InterviewQuestion[];
  try {
    const out = await composeInterviewGuide({
      candidate,
      jobTitle: null,
      campaignId: analysis.campaignId ?? 'CAMP-?',
    });
    questions = out.guide.questions;
  } catch (err) {
    // La trame n'a pas pu être régénérée — échec transitoire (LLM), rejouable.
    return {
      ok: false,
      status: 'send_failed',
      retryable: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const ownerLabel = analysis.campaignId ?? 'la campagne';
  const send = await sendBrief({
    recipients,
    candidate,
    jobTitle: null,
    ownerLabel,
    questions,
    input,
  });
  if (!send.ok) {
    return {
      ok: false,
      status: 'send_failed',
      retryable: true,
      error: send.error,
    };
  }
  await createScheduledBrief({
    ownerId: analysis.campaignId,
    jobTitle: null,
    candidate,
    questions,
    delivery: delivery(send.messageId),
  });
  return {
    ok: true,
    status: 'regenerated_delivered',
    retryable: false,
    messageId: send.messageId,
  };
}
