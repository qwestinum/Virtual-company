/**
 * /api/scheduler (Session 5 round 4).
 *
 * Pour un candidat accepté, génère la trame d'entretien (6-8 questions
 * ciblées) et l'envoie au DRH sous forme d'email + artefact Storage.
 *
 * Cal.com gère ses propres notifications de réservation côté DRH —
 * notre app ne duplique pas ce flux. Le brief est envoyé AU MOMENT de
 * l'invitation candidat (en parallèle du mail Mail Composer), pour
 * que le DRH ait déjà la prep en main quand le candidat choisit son
 * créneau.
 *
 * Flow :
 *   1. composeInterviewGuide (LLM)
 *   2. sendEmail au DRH (Resend) avec subject contextualisé +
 *      synthèse + questions + lien Cal.com du candidat
 *   3. uploadArtifact + insertArtifactMeta pour la trace Storage
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  composeInterviewGuide,
  MailComposerError,
} from '@/lib/agents/server/mail-composer-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import { uploadArtifact } from '@/lib/storage/blob';
import { MailCandidateSchema } from '@/types/mail-candidate';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  artifactId: z.string().min(1),
  campaignId: z.string().min(1),
  jobTitle: z.string().nullable(),
  candidate: MailCandidateSchema,
  /**
   * Override optionnel — sinon lu depuis CAL_COM_EVENT_URL côté
   * serveur.
   */
  bookingUrl: z.string().url().optional(),
});
type RequestBody = z.infer<typeof RequestSchema>;

function buildDrhEmailHtml(args: {
  candidate: RequestBody['candidate'];
  jobTitle: string | null;
  campaignId: string;
  bookingUrl: string;
  questions: Array<{ theme: string; question: string }>;
}): string {
  const c = args.candidate;
  const questionsHtml = args.questions
    .map(
      (q) =>
        `<li><strong>${escapeHtml(q.theme)}</strong> — ${escapeHtml(q.question)}</li>`,
    )
    .join('');
  return [
    `<p>Nouveau candidat retenu pour <strong>${escapeHtml(args.jobTitle ?? args.campaignId)}</strong>.</p>`,
    '<h3>Candidat</h3>',
    `<ul>`,
    `<li>Nom : ${escapeHtml(c.candidateName)}</li>`,
    c.email ? `<li>Email : ${escapeHtml(c.email)}</li>` : '',
    c.phone ? `<li>Téléphone : ${escapeHtml(c.phone)}</li>` : '',
    `<li>Score CV : ${c.score}/100</li>`,
    `</ul>`,
    '<h3>Synthèse</h3>',
    `<p>${escapeHtml(c.summary)}</p>`,
    '<h3>Verdict CV Analyzer</h3>',
    `<p>${escapeHtml(c.justification)}</p>`,
    '<h3>Trame d\'entretien proposée</h3>',
    `<ul>${questionsHtml}</ul>`,
    `<p>Le candidat a reçu un lien pour réserver un créneau : <a href="${escapeAttr(args.bookingUrl)}">${escapeHtml(args.bookingUrl)}</a>. Tu seras notifié·e par Cal.com dès la réservation.</p>`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function buildDrhMarkdownTrace(args: {
  candidate: RequestBody['candidate'];
  jobTitle: string | null;
  campaignId: string;
  bookingUrl: string;
  questions: Array<{ theme: string; question: string }>;
  status: 'sent' | 'skipped_no_drh' | 'skipped_no_config' | 'send_failed';
  error?: string;
}): string {
  const c = args.candidate;
  const lines = [
    `# Brief entretien — ${c.candidateName}`,
    '',
    `Statut envoi DRH : **${statusLabel(args.status, args.error)}**`,
    `Campagne : ${args.campaignId}`,
    args.jobTitle ? `Poste : ${args.jobTitle}` : '',
    '',
    '## Coordonnées',
    `- Nom : ${c.candidateName}`,
    c.email ? `- Email : ${c.email}` : '- Email : *manquant*',
    c.phone ? `- Téléphone : ${c.phone}` : '',
    `- Score : ${c.score}/100`,
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

function statusLabel(
  status: 'sent' | 'skipped_no_drh' | 'skipped_no_config' | 'send_failed',
  error?: string,
): string {
  return {
    sent: 'envoyé au DRH',
    skipped_no_drh: 'non envoyé — EMAIL_DRH non configurée',
    skipped_no_config: 'non envoyé — service email non configuré',
    send_failed: `non envoyé — erreur (${error ?? 'inconnue'})`,
  }[status];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: RequestBody;
  try {
    parsed = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  const bookingUrl =
    parsed.bookingUrl ?? process.env.CAL_COM_EVENT_URL ?? null;
  if (!bookingUrl) {
    return NextResponse.json(
      {
        error: 'cal_com_not_configured',
        message: 'CAL_COM_EVENT_URL is missing.',
      },
      { status: 503 },
    );
  }

  // 1. Trame d'entretien LLM.
  let questions: Array<{ theme: string; question: string }>;
  try {
    const out = await composeInterviewGuide({
      candidate: parsed.candidate,
      jobTitle: parsed.jobTitle,
      campaignId: parsed.campaignId,
    });
    questions = out.guide.questions;
  } catch (err) {
    if (err instanceof MailComposerError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 502 },
      );
    }
    if (err instanceof AIProviderError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'compose_failed', message: (err as Error).message },
      { status: 500 },
    );
  }

  // 2. Envoi DRH (si EMAIL_DRH configurée).
  const drhAddress = process.env.EMAIL_DRH;
  let status: 'sent' | 'skipped_no_drh' | 'skipped_no_config' | 'send_failed' =
    'skipped_no_drh';
  let sendError: string | undefined;
  if (drhAddress) {
    const html = buildDrhEmailHtml({
      candidate: parsed.candidate,
      jobTitle: parsed.jobTitle,
      campaignId: parsed.campaignId,
      bookingUrl,
      questions,
    });
    const sendResult = await sendEmail({
      to: drhAddress,
      subject: `Brief entretien — ${parsed.candidate.candidateName} (${parsed.jobTitle ?? parsed.campaignId})`,
      html,
    });
    if (sendResult.ok) {
      status = 'sent';
    } else if (sendResult.error === 'email_not_configured') {
      status = 'skipped_no_config';
    } else {
      status = 'send_failed';
      sendError = sendResult.error;
    }
  }

  // 3. Trace markdown Storage.
  const fileName = `brief-entretien-${slug(parsed.candidate.candidateName)}.md`;
  const markdown = buildDrhMarkdownTrace({
    candidate: parsed.candidate,
    jobTitle: parsed.jobTitle,
    campaignId: parsed.campaignId,
    bookingUrl,
    questions,
    status,
    error: sendError,
  });
  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  try {
    const upload = await uploadArtifact({
      owner: parsed.campaignId.startsWith('TASK-')
        ? { kind: 'task', id: parsed.campaignId }
        : { kind: 'campaign', id: parsed.campaignId },
      name: fileName,
      content: markdown,
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[scheduler] storage upload failed', err);
    }
  }

  try {
    await insertArtifactMeta({
      id: parsed.artifactId,
      campaignId: parsed.campaignId.startsWith('TASK-')
        ? null
        : parsed.campaignId,
      taskId: parsed.campaignId.startsWith('TASK-') ? parsed.campaignId : null,
      kind: 'other',
      name: fileName,
      mime: 'text/markdown',
      storageBucket,
      storagePath,
      publicUrl,
      metadata: {
        kind: 'interview_brief',
        candidate: parsed.candidate.candidateName,
        status,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[scheduler] insertArtifactMeta failed', err);
    }
  }

  return NextResponse.json({
    status,
    fileName,
    publicUrl,
    questions,
    error: sendError ?? null,
  });
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidat';
}
