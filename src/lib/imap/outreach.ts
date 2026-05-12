/**
 * Orchestration outreach pour les CVs reçus par IMAP
 * (Session 5 round 5 — fix : le poller n'envoyait jamais de mail
 * refus/invitation, c'était limité au chemin upload manuel).
 *
 * Pour un candidat analysé par le poller :
 *   - sous seuil → mail de refus envoyé au candidat
 *   - au-dessus  → mail d'invitation Cal.com au candidat + brief
 *                  entretien envoyé au DRH (synthèse + trame)
 *
 * On réutilise les composers serveur (`composeCandidateMail`,
 * `composeInterviewGuide`) et le service email Resend. Toutes les
 * erreurs sont capturées et loggées dans le journal — un mail
 * raté ne tue pas le poller, le DRH retrouve la trace dans la
 * table journal et l'artefact texte dans Storage.
 *
 * Différent du flux client `dispatchPostAnalysisOutreach` :
 *   - pas de bulles chat (le DRH n'est pas forcément sur la
 *     campagne au moment du poll)
 *   - pas de hydrateArtifact côté store (on est serveur, le store
 *     se rechargera via /api/artifacts au prochain refresh)
 *   - sequentialité par candidat (un seul CV par appel)
 */

import {
  composeCandidateMail,
  composeInterviewGuide,
} from '@/lib/agents/server/mail-composer-execute';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import { uploadArtifact } from '@/lib/storage/blob';
import type { CVAnalysisResult } from '@/types/cv-analysis';

export type OutreachInput = {
  mailboxId: string;
  campaignId: string;
  jobTitle: string | null;
  candidate: CVAnalysisResult;
  /** UID IMAP du message d'origine, pour traçabilité dans le journal. */
  uid: string;
};

export async function dispatchImapCandidateOutreach(
  input: OutreachInput,
): Promise<void> {
  const { candidate } = input;
  const mode = candidate.aboveThreshold ? 'invite' : 'reject';
  const isTaskOwner = input.campaignId.startsWith('TASK-');
  const ownerKey = isTaskOwner
    ? { taskId: input.campaignId }
    : { campaignId: input.campaignId };

  // Lien Cal.com obligatoire en mode invite. Si absent, on logue un
  // warning et on n'envoie pas l'invitation (mais on continue le
  // workflow pour ne pas tout planter).
  const bookingUrl = process.env.CAL_COM_EVENT_URL ?? null;

  // ─── Phase 1 : mail candidat (refus ou invitation) ─────────────────

  if (mode === 'invite' && !bookingUrl) {
    await appendJournalEntry({
      action: 'imap_outreach_skipped',
      actor: 'imap_poller',
      campaignId: isTaskOwner ? null : input.campaignId,
      payload: {
        reason: 'cal_com_not_configured',
        candidate: candidate.candidateName,
        uid: input.uid,
      },
    });
  } else {
    await composeAndSendCandidateMail({
      mode,
      input,
      ownerKey,
      bookingUrl: mode === 'invite' ? bookingUrl! : undefined,
    });
  }

  // ─── Phase 2 : brief DRH (seulement pour les acceptés) ─────────────

  if (mode === 'invite' && bookingUrl) {
    await composeAndSendInterviewBrief({
      input,
      ownerKey,
      bookingUrl,
    });
  }
}

async function composeAndSendCandidateMail(args: {
  mode: 'reject' | 'invite';
  input: OutreachInput;
  ownerKey: { campaignId: string } | { taskId: string };
  bookingUrl?: string;
}): Promise<void> {
  const { mode, input, ownerKey, bookingUrl } = args;
  const { candidate } = input;
  const isTaskOwner = 'taskId' in ownerKey;
  const campaignIdForJournal = isTaskOwner ? null : input.campaignId;
  const taskIdForJournal = isTaskOwner ? input.campaignId : null;

  let composed: { subject: string; html: string };
  try {
    const out = await composeCandidateMail({
      mode,
      candidate,
      jobTitle: input.jobTitle,
      campaignId: input.campaignId,
      bookingUrl,
    });
    composed = out.mail;
  } catch (err) {
    await appendJournalEntry({
      action: 'imap_outreach_failed',
      actor: 'imap_poller',
      campaignId: campaignIdForJournal,
      payload: {
        stage: 'compose',
        mode,
        candidate: candidate.candidateName,
        uid: input.uid,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  let sentTo: string | null = null;
  let status:
    | 'sent'
    | 'skipped_no_email'
    | 'skipped_no_config'
    | 'send_failed' = 'skipped_no_config';
  let sendError: string | undefined;

  if (!candidate.email) {
    status = 'skipped_no_email';
  } else {
    const sendResult = await sendEmail({
      to: candidate.email,
      subject: composed.subject,
      html: composed.html,
      replyTo: process.env.EMAIL_DRH || undefined,
    });
    if (sendResult.ok) {
      status = 'sent';
      sentTo = candidate.email;
    } else if (sendResult.error === 'email_not_configured') {
      status = 'skipped_no_config';
    } else {
      status = 'send_failed';
      sendError = sendResult.error;
    }
  }

  // Artefact texte avec la trace.
  const fileName = `${mode === 'reject' ? 'refus' : 'invitation'}-${slug(candidate.candidateName)}-${input.uid}.md`;
  const markdown = renderMailTrace({
    mode,
    candidate,
    jobTitle: input.jobTitle,
    campaignId: input.campaignId,
    subject: composed.subject,
    html: composed.html,
    sentTo,
    status,
    sendError,
  });

  const artifactId = `art_imap_mail_${input.uid}_${mode}_${Math.random().toString(36).slice(2, 6)}`;
  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  try {
    const upload = await uploadArtifact({
      owner: isTaskOwner
        ? { kind: 'task', id: input.campaignId }
        : { kind: 'campaign', id: input.campaignId },
      name: fileName,
      content: markdown,
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] storage upload failed', err);
    }
  }

  try {
    await insertArtifactMeta({
      id: artifactId,
      campaignId: campaignIdForJournal,
      taskId: taskIdForJournal,
      kind: 'other',
      name: fileName,
      mime: 'text/markdown',
      storageBucket,
      storagePath,
      publicUrl,
      metadata: {
        source: 'imap',
        mode,
        candidate: candidate.candidateName,
        candidateEmail: candidate.email,
        status,
        uid: input.uid,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] insertArtifactMeta failed', err);
    }
  }

  await appendJournalEntry({
    action: 'imap_outreach_mail',
    actor: 'imap_poller',
    campaignId: campaignIdForJournal,
    payload: {
      mode,
      status,
      candidate: candidate.candidateName,
      sentTo,
      artifactId,
      publicUrl,
      uid: input.uid,
      error: sendError,
      taskId: taskIdForJournal ?? undefined,
    },
  });
}

async function composeAndSendInterviewBrief(args: {
  input: OutreachInput;
  ownerKey: { campaignId: string } | { taskId: string };
  bookingUrl: string;
}): Promise<void> {
  const { input, ownerKey, bookingUrl } = args;
  const { candidate } = input;
  const isTaskOwner = 'taskId' in ownerKey;
  const campaignIdForJournal = isTaskOwner ? null : input.campaignId;
  const taskIdForJournal = isTaskOwner ? input.campaignId : null;

  let questions: Array<{ theme: string; question: string }>;
  try {
    const out = await composeInterviewGuide({
      candidate,
      jobTitle: input.jobTitle,
      campaignId: input.campaignId,
    });
    questions = out.guide.questions;
  } catch (err) {
    await appendJournalEntry({
      action: 'imap_outreach_failed',
      actor: 'imap_poller',
      campaignId: campaignIdForJournal,
      payload: {
        stage: 'compose_guide',
        candidate: candidate.candidateName,
        uid: input.uid,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  const drhAddress = process.env.EMAIL_DRH;
  let status:
    | 'sent'
    | 'skipped_no_drh'
    | 'skipped_no_config'
    | 'send_failed' = 'skipped_no_drh';
  let sendError: string | undefined;

  if (drhAddress) {
    const html = renderDrhBriefHtml({
      candidate,
      jobTitle: input.jobTitle,
      campaignId: input.campaignId,
      bookingUrl,
      questions,
    });
    const sendResult = await sendEmail({
      to: drhAddress,
      subject: `Brief entretien — ${candidate.candidateName} (${input.jobTitle ?? input.campaignId})`,
      html,
    });
    if (sendResult.ok) status = 'sent';
    else if (sendResult.error === 'email_not_configured')
      status = 'skipped_no_config';
    else {
      status = 'send_failed';
      sendError = sendResult.error;
    }
  }

  const fileName = `brief-entretien-${slug(candidate.candidateName)}-${input.uid}.md`;
  const markdown = renderBriefMarkdown({
    candidate,
    jobTitle: input.jobTitle,
    campaignId: input.campaignId,
    bookingUrl,
    questions,
    status,
    sendError,
  });

  const artifactId = `art_imap_brief_${input.uid}_${Math.random().toString(36).slice(2, 6)}`;
  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  try {
    const upload = await uploadArtifact({
      owner: isTaskOwner
        ? { kind: 'task', id: input.campaignId }
        : { kind: 'campaign', id: input.campaignId },
      name: fileName,
      content: markdown,
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] brief storage upload failed', err);
    }
  }

  try {
    await insertArtifactMeta({
      id: artifactId,
      campaignId: campaignIdForJournal,
      taskId: taskIdForJournal,
      kind: 'other',
      name: fileName,
      mime: 'text/markdown',
      storageBucket,
      storagePath,
      publicUrl,
      metadata: {
        source: 'imap',
        kind: 'interview_brief',
        candidate: candidate.candidateName,
        status,
        uid: input.uid,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] brief insertArtifactMeta failed', err);
    }
  }

  await appendJournalEntry({
    action: 'imap_outreach_brief',
    actor: 'imap_poller',
    campaignId: campaignIdForJournal,
    payload: {
      candidate: candidate.candidateName,
      status,
      artifactId,
      publicUrl,
      uid: input.uid,
      error: sendError,
      taskId: taskIdForJournal ?? undefined,
    },
  });
}

// ─── Helpers de rendu (markdown + HTML email) ─────────────────────────

function renderMailTrace(args: {
  mode: 'reject' | 'invite';
  candidate: CVAnalysisResult;
  jobTitle: string | null;
  campaignId: string;
  subject: string;
  html: string;
  sentTo: string | null;
  status: 'sent' | 'skipped_no_email' | 'skipped_no_config' | 'send_failed';
  sendError?: string;
}): string {
  const label = {
    sent: 'envoyé',
    skipped_no_email: 'non envoyé — email candidat manquant',
    skipped_no_config: 'non envoyé — service email non configuré',
    send_failed: `non envoyé — erreur (${args.sendError ?? 'inconnue'})`,
  }[args.status];
  return [
    `# Mail ${args.mode === 'reject' ? 'de refus' : "d'invitation"} — ${args.candidate.candidateName}`,
    '',
    `Statut : **${label}**`,
    args.sentTo ? `Destinataire effectif : ${args.sentTo}` : '',
    `Campagne : ${args.campaignId}`,
    args.jobTitle ? `Poste : ${args.jobTitle}` : '',
    `Score CV : ${args.candidate.score}/100`,
    `Source : IMAP`,
    '',
    `## Objet`,
    args.subject,
    '',
    `## Corps`,
    args.html,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function renderBriefMarkdown(args: {
  candidate: CVAnalysisResult;
  jobTitle: string | null;
  campaignId: string;
  bookingUrl: string;
  questions: Array<{ theme: string; question: string }>;
  status: 'sent' | 'skipped_no_drh' | 'skipped_no_config' | 'send_failed';
  sendError?: string;
}): string {
  const c = args.candidate;
  const label = {
    sent: 'envoyé au DRH',
    skipped_no_drh: "non envoyé — EMAIL_DRH non configurée",
    skipped_no_config: 'non envoyé — service email non configuré',
    send_failed: `non envoyé — erreur (${args.sendError ?? 'inconnue'})`,
  }[args.status];
  const lines = [
    `# Brief entretien — ${c.candidateName}`,
    '',
    `Statut envoi DRH : **${label}**`,
    `Campagne : ${args.campaignId}`,
    args.jobTitle ? `Poste : ${args.jobTitle}` : '',
    `Source : IMAP`,
    '',
    '## Coordonnées',
    `- Nom : ${c.candidateName}`,
    c.email ? `- Email : ${c.email}` : '- Email : *manquant*',
    c.phone ? `- Téléphone : ${c.phone}` : '',
    `- Score : ${c.score}/100`,
    `- Expérience : ${c.experienceYears} an(s)`,
    '',
    '## Synthèse',
    c.summary,
    '',
    '## Verdict CV Analyzer',
    c.justification,
    '',
    "## Trame d'entretien proposée",
  ];
  for (const q of args.questions) {
    lines.push(`- **${q.theme}** — ${q.question}`);
  }
  lines.push('', `Lien Cal.com candidat : ${args.bookingUrl}`);
  return lines.filter((l) => l !== '').join('\n');
}

function renderDrhBriefHtml(args: {
  candidate: CVAnalysisResult;
  jobTitle: string | null;
  campaignId: string;
  bookingUrl: string;
  questions: Array<{ theme: string; question: string }>;
}): string {
  const c = args.candidate;
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const qs = args.questions
    .map(
      (q) =>
        `<li><strong>${escape(q.theme)}</strong> — ${escape(q.question)}</li>`,
    )
    .join('');
  return [
    `<p>Nouveau candidat retenu pour <strong>${escape(args.jobTitle ?? args.campaignId)}</strong> (reçu par email).</p>`,
    '<h3>Candidat</h3>',
    '<ul>',
    `<li>Nom : ${escape(c.candidateName)}</li>`,
    c.email ? `<li>Email : ${escape(c.email)}</li>` : '',
    c.phone ? `<li>Téléphone : ${escape(c.phone)}</li>` : '',
    `<li>Score CV : ${c.score}/100</li>`,
    `<li>Expérience estimée : ${c.experienceYears} an(s)</li>`,
    '</ul>',
    '<h3>Synthèse</h3>',
    `<p>${escape(c.summary)}</p>`,
    '<h3>Verdict CV Analyzer</h3>',
    `<p>${escape(c.justification)}</p>`,
    "<h3>Trame d'entretien proposée</h3>",
    `<ul>${qs}</ul>`,
    `<p>Le candidat a reçu un lien pour réserver un créneau : <a href="${escape(args.bookingUrl)}">${escape(args.bookingUrl)}</a>. Tu seras notifié·e par Cal.com dès la réservation.</p>`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'candidat'
  );
}
