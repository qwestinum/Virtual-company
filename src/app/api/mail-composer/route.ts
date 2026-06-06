/**
 * /api/mail-composer (Session 5 round 4).
 *
 * Endpoint orchestré : compose le mail (LLM) → envoie via Resend →
 * persiste un artefact metadata + Storage (markdown lisible côté DRH).
 *
 * Le client appelle ce endpoint une fois par destinataire ; la route
 * gère elle-même la cascade ; la réponse récapitule ce qui s'est
 * réellement passé pour que la bulle Manager puisse être posée avec
 * un wording fidèle (« envoyé », « non envoyé — config manquante »…).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  composeCandidateMail,
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
  mode: z.enum(['reject', 'invite']),
  candidate: MailCandidateSchema,
  /**
   * Override optionnel. Si absent en mode 'invite', on lit
   * CAL_COM_EVENT_URL côté serveur. Si rien n'est configuré, on
   * répond 503 (le mail d'invitation sans URL serait inutile).
   */
  bookingUrl: z.string().url().optional(),
});

type RequestBody = z.infer<typeof RequestSchema>;

function buildMarkdownTrace(
  body: RequestBody,
  subject: string,
  html: string,
  sentTo: string | null,
  status: 'sent' | 'skipped_no_email' | 'skipped_no_config' | 'send_failed',
  error?: string,
): string {
  const statusLabel = {
    sent: 'envoyé',
    skipped_no_email: 'non envoyé — email candidat manquant',
    skipped_no_config: 'non envoyé — service email non configuré',
    send_failed: `non envoyé — erreur (${error ?? 'inconnue'})`,
  }[status];
  return [
    `# Mail ${body.mode === 'reject' ? 'de refus' : "d'invitation"} — ${body.candidate.candidateName}`,
    '',
    `Statut : **${statusLabel}**`,
    sentTo ? `Destinataire effectif : ${sentTo}` : '',
    `Campagne : ${body.campaignId}`,
    body.jobTitle ? `Poste : ${body.jobTitle}` : '',
    `Score CV : ${body.candidate.score}/100`,
    '',
    `## Objet`,
    subject,
    '',
    `## Corps`,
    html,
  ]
    .filter((l) => l !== '')
    .join('\n');
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

  // Résolution du lien Cal.com pour le mode invitation. Le client
  // peut le fournir explicitement (override), sinon on lit la conf
  // serveur. Sans aucun des deux, refus net : un mail d'invitation
  // sans URL de booking est inutile.
  let bookingUrl: string | undefined = parsed.bookingUrl;
  if (parsed.mode === 'invite' && !bookingUrl) {
    bookingUrl = process.env.CAL_COM_EVENT_URL || undefined;
  }
  if (parsed.mode === 'invite' && !bookingUrl) {
    return NextResponse.json(
      {
        error: 'cal_com_not_configured',
        message:
          'CAL_COM_EVENT_URL is missing. Configure it in .env.local or pass bookingUrl explicitly.',
      },
      { status: 503 },
    );
  }

  // 1. Composition LLM.
  let composed: { subject: string; html: string };
  try {
    const out = await composeCandidateMail({
      mode: parsed.mode,
      candidate: parsed.candidate,
      jobTitle: parsed.jobTitle,
      campaignId: parsed.campaignId,
      bookingUrl,
    });
    composed = out.mail;
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

  // 2. Envoi via Resend. Si pas de config ou pas d'email candidat,
  // on n'envoie pas mais on persiste quand même l'artefact (le DRH
  // peut copier-coller le contenu manuellement).
  let sentTo: string | null = null;
  let status: 'sent' | 'skipped_no_email' | 'skipped_no_config' | 'send_failed' =
    'skipped_no_config';
  let sendError: string | undefined;

  if (!parsed.candidate.email) {
    status = 'skipped_no_email';
  } else {
    const sendResult = await sendEmail({
      to: parsed.candidate.email,
      subject: composed.subject,
      html: composed.html,
      replyTo: process.env.EMAIL_DRH || undefined,
    });
    if (sendResult.ok) {
      status = 'sent';
      sentTo = parsed.candidate.email;
    } else if (sendResult.error === 'email_not_configured') {
      status = 'skipped_no_config';
    } else {
      status = 'send_failed';
      sendError = sendResult.error;
    }
  }

  // 3. Trace markdown dans Storage + metadata Supabase.
  const fileName = `${parsed.mode === 'reject' ? 'refus' : 'invitation'}-${slug(parsed.candidate.candidateName)}.md`;
  const markdown = buildMarkdownTrace(
    parsed,
    composed.subject,
    composed.html,
    sentTo,
    status,
    sendError,
  );

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
      console.error('[mail-composer] storage upload failed', err);
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
        mode: parsed.mode,
        candidate: parsed.candidate.candidateName,
        candidateEmail: parsed.candidate.email,
        status,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[mail-composer] insertArtifactMeta failed', err);
    }
  }

  return NextResponse.json({
    status,
    sentTo,
    subject: composed.subject,
    fileName,
    publicUrl,
    error: sendError ?? null,
  });
}

/** Slug ASCII basique pour les noms de fichier. */
function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidat';
}
