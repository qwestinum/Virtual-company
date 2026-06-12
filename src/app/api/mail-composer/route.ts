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

import { buildInterviewMail } from '@/lib/agents/server/interview-mail';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
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
   * UID de l'analyse (rapprochement dashboard). Permet de journaliser
   * `imap_outreach_mail` pour l'envoi AUTO (hors HITL) → le candidat avance à
   * « invité »/« rejeté » comme via le poller IMAP.
   */
  uid: z.string().optional(),
  /**
   * HITL — mode BROUILLON : on rédige le mail et on persiste l'artefact,
   * mais on N'ENVOIE PAS (l'envoi est différé jusqu'à validation humaine).
   */
  draft: z.boolean().optional(),
  /**
   * HITL — mode PREVIEW : recompose la base éditable depuis le template courant
   * (« Vérifier le mail »). Ne persiste rien, n'envoie rien, ne bloque jamais —
   * renvoie juste { subject, html }. Sert à rafraîchir le brouillon à l'ouverture
   * de l'éditeur pour repartir du template à jour plutôt que d'un snapshot figé.
   */
  preview: z.boolean().optional(),
  /**
   * HITL — OVERRIDE : envoyer ce contenu (éventuellement édité par le DRH dans
   * « Vérifier le mail ») au lieu de re-composer. Le lien d'agenda est déjà
   * dans le html édité. Incompatible avec `draft`.
   */
  mail: z.object({ subject: z.string().min(1), html: z.string().min(1) }).optional(),
});

type RequestBody = z.infer<typeof RequestSchema>;

type ComposeStatus =
  | 'sent'
  | 'draft'
  | 'skipped_no_email'
  | 'skipped_no_config'
  | 'send_failed';

function buildMarkdownTrace(
  body: RequestBody,
  subject: string,
  html: string,
  sentTo: string | null,
  status: ComposeStatus,
  error?: string,
): string {
  const statusLabel = {
    sent: 'envoyé',
    draft: 'brouillon — non envoyé (en attente de validation)',
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

  // PREVIEW (HITL « Vérifier le mail ») : recompose la base éditable depuis le
  // template courant, sans rien envoyer ni persister. Comme un brouillon, ne
  // bloque jamais (placeholder de lien d'agenda si non configuré).
  if (parsed.preview) {
    try {
      const result = await buildInterviewMail({
        mode: parsed.mode,
        candidate: parsed.candidate,
        jobTitle: parsed.jobTitle,
        campaignId: parsed.campaignId,
        draft: true,
      });
      return NextResponse.json({
        status: 'preview',
        subject: result.mail.subject,
        html: result.mail.html,
      });
    } catch (err) {
      return NextResponse.json(
        { error: 'compose_failed', message: (err as Error).message },
        { status: 500 },
      );
    }
  }

  // Override (HITL) : on envoie le contenu fourni tel quel (le DRH l'a édité
  // dans « Vérifier le mail », le lien d'agenda est déjà dans le html). Pas de
  // rendu, pas de contrôle du lien.
  if (parsed.mail) {
    return await finalizeSend(parsed, parsed.mail);
  }

  // Rendu DÉTERMINISTE du message (acceptation+invitation ou refus) à partir du
  // template configuré — plus aucune génération LLM. La seule validation : pour
  // une acceptation réellement envoyée, le lien d'agenda doit être configuré.
  // En mode BROUILLON (HITL), on compose quand même avec un placeholder visible
  // que le DRH complète avant l'envoi.
  let composed: { subject: string; html: string };
  try {
    const result = await buildInterviewMail({
      mode: parsed.mode,
      candidate: parsed.candidate,
      jobTitle: parsed.jobTitle,
      campaignId: parsed.campaignId,
      draft: parsed.draft,
    });
    if (result.blocked) {
      return NextResponse.json(
        {
          error: 'agenda_link_not_configured',
          message: 'Lien d’agenda non configuré dans les paramètres.',
        },
        { status: 503 },
      );
    }
    composed = result.mail;
  } catch (err) {
    return NextResponse.json(
      { error: 'compose_failed', message: (err as Error).message },
      { status: 500 },
    );
  }

  return await finalizeSend(parsed, composed);
}

/**
 * Envoi (sauf mode draft) + trace Storage + metadata, puis réponse. Partagé par
 * la composition LLM et l'override HITL (mail édité).
 */
async function finalizeSend(
  parsed: RequestBody,
  composed: { subject: string; html: string },
): Promise<NextResponse> {
  let sentTo: string | null = null;
  let status: ComposeStatus = 'skipped_no_config';
  let sendError: string | undefined;

  if (parsed.draft) {
    // HITL : on s'arrête à la rédaction. L'envoi sera fait à la validation.
    status = 'draft';
  } else if (!parsed.candidate.email) {
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

  // Journalise l'outreach UNIQUEMENT pour l'envoi AUTO (hors HITL) : ni brouillon
  // (`draft`), ni override HITL (`mail`, déjà comptabilisé par `hitl_validation_sent`).
  // Permet au dashboard de faire avancer le candidat (clé par `uid`) à
  // « invité »/« rejeté », comme le poller IMAP. Best-effort.
  if (!parsed.draft && !parsed.mail && parsed.uid) {
    try {
      await appendJournalEntry({
        action: 'imap_outreach_mail',
        actor: 'manager-chat',
        campaignId: parsed.campaignId.startsWith('TASK-')
          ? null
          : parsed.campaignId,
        payload: { uid: parsed.uid, mode: parsed.mode, status },
      });
    } catch (err) {
      if (!(err instanceof SupabaseNotConfiguredError)) {
        console.error('[mail-composer] journal outreach failed', err);
      }
    }
  }

  return NextResponse.json({
    status,
    sentTo,
    subject: composed.subject,
    html: composed.html,
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
