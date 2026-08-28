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

import { getSynthesisReplyToForCampaign } from '@/lib/campaign/synthesis-recipients';
import { z } from 'zod';

import {
  buildInterviewMail,
  type BuildInterviewMailResult,
} from '@/lib/agents/server/interview-mail';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
} from '@/lib/db/repos/imap-outreach-claims';
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
   * Identifiant d'ANALYSE — clé d'idempotence du lien de réservation natif.
   * Distinct de `uid` : l'uid IMAP n'est unique que par boîte. Sans lui, une
   * campagne en réservation native ne peut PAS émettre d'invitation (503).
   */
  analysisId: z.string().optional(),
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
  /**
   * HITL (audit C6) — id de la validation d'origine. Quand présent, l'envoi
   * est protégé par le claim d'idempotence deux-phases
   * (`imap_outreach_claims`, scope `('hitl_validation', validationId, mode)` —
   * la MÊME table que le chemin auto, aucun mécanisme parallèle) : un retry
   * après un envoi réussi ne renverra JAMAIS un second mail (`duplicate`).
   */
  validationId: z.string().optional(),
});

type RequestBody = z.infer<typeof RequestSchema>;

type ComposeStatus =
  | 'sent'
  | 'draft'
  | 'skipped_no_email'
  | 'skipped_no_config'
  | 'send_failed'
  // Claim déjà confirmé (mail parti lors d'une tentative précédente) ou envoi
  // concurrent en cours : ce process n'envoie rien. Pour le client HITL c'est
  // une issue TERMINALE non-erreur (il enchaîne sur la finalisation).
  | 'duplicate';

function buildMarkdownTrace(
  body: RequestBody,
  subject: string,
  html: string,
  sentTo: string | null,
  status: ComposeStatus,
  error?: string,
  providerMessageId?: string | null,
): string {
  const statusLabel = {
    sent: 'envoyé',
    draft: 'brouillon — non envoyé (en attente de validation)',
    skipped_no_email: 'non envoyé — email candidat manquant',
    skipped_no_config: 'non envoyé — service email non configuré',
    send_failed: `non envoyé — erreur (${error ?? 'inconnue'})`,
    // Jamais tracé en pratique (court-circuit avant l'artefact) — présent pour
    // l'exhaustivité du type.
    duplicate: 'déjà envoyé lors d’une tentative précédente — aucun doublon',
  }[status];
  return [
    `# Mail ${body.mode === 'reject' ? 'de refus' : "d'invitation"} — ${body.candidate.candidateName}`,
    '',
    `Statut : **${statusLabel}**`,
    sentTo ? `Destinataire effectif : ${sentTo}` : '',
    // Message-id Resend : permet de vérifier la LIVRAISON réelle (≠ « accepté »)
    // via GET /api/email/status?id=… — distingue livré / bounce / spam.
    providerMessageId
      ? `Resend message-id : ${providerMessageId} (statut livraison : GET /api/email/status?id=${providerMessageId})`
      : '',
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

/** Un message par cause : chacune se répare dans un écran différent. */
const BLOCKED_MESSAGES: Record<
  NonNullable<BuildInterviewMailResult['blockedReason']>,
  string
> = {
  agenda_link_not_configured: 'Lien d’agenda non configuré dans les paramètres.',
  native_link_unavailable:
    'Réservation native : le recruteur référent de cette campagne n’a pas de disponibilités configurées.',
  meeting_location_missing:
    'Réservation native : aucun lieu d’entretien n’est renseigné (agenda du référent ou lieu de la campagne). Sans lui, le candidat réserverait sans savoir où se tient le rendez-vous.',
};

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
      // Le preview ÉMET le lien (émission idempotente par analyse) : c'est
      // ce qui fait que le relecteur voit le jeton qui partira vraiment, et
      // qu'un second preview ne crée pas un second lien.
      const result = await buildInterviewMail({
        mode: parsed.mode,
        candidate: parsed.candidate,
        jobTitle: parsed.jobTitle,
        campaignId: parsed.campaignId,
        analysisId: parsed.analysisId ?? parsed.uid ?? null,
        uid: parsed.uid ?? null,
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
      analysisId: parsed.analysisId ?? parsed.uid ?? null,
      uid: parsed.uid ?? null,
      draft: parsed.draft,
    });
    if (result.blocked) {
      // Trois causes — et trois gestes différents pour le DRH : renseigner un
      // lien dans les réglages, donner des disponibilités au référent, ou lui
      // poser un lieu d'entretien. Un message générique renverrait au mauvais
      // écran, ce qui coûte plus cher qu'un blocage.
      const reason = result.blockedReason ?? 'agenda_link_not_configured';
      return NextResponse.json(
        { error: reason, message: BLOCKED_MESSAGES[reason] },
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
  let providerMessageId: string | null = null;
  let status: ComposeStatus = 'skipped_no_config';
  let sendError: string | undefined;

  // Claim d'idempotence du chemin HITL (audit C6) — posé juste avant l'envoi,
  // confirmé après, relâché si l'envoi n'aboutit pas (échec propre OU
  // exception). Même mécanisme deux-phases que le chemin auto IMAP.
  const claimKey =
    parsed.validationId && !parsed.draft
      ? ({
          mailboxId: 'hitl_validation',
          uid: parsed.validationId,
          mode: parsed.mode,
        } as const)
      : null;

  if (parsed.draft) {
    // HITL : on s'arrête à la rédaction. L'envoi sera fait à la validation.
    status = 'draft';
  } else if (!parsed.candidate.email) {
    status = 'skipped_no_email';
  } else {
    if (claimKey) {
      const verdict = await claimOutreach(claimKey);
      if (verdict === 'already_sent' || verdict === 'in_flight') {
        // Mail déjà parti (prouvé) ou envoi concurrent en cours : ne rien
        // renvoyer. Le client HITL traite `duplicate` comme un succès d'envoi
        // (il enchaîne sur la finalisation) — c'est ce qui rend le RETRY sûr.
        return NextResponse.json({
          status: 'duplicate' as ComposeStatus,
          providerMessageId: null,
        });
      }
    }
    try {
      const sendResult = await sendEmail({
        to: parsed.candidate.email,
        subject: composed.subject,
        html: composed.html,
        // replyTo PAR CAMPAGNE : référent → 1re adresse de synthèse → env.
        replyTo:
          (await getSynthesisReplyToForCampaign(
            parsed.campaignId.startsWith('TASK-') ? null : parsed.campaignId,
          )) ??
          process.env.EMAIL_DRH ??
          undefined,
      });
      if (sendResult.ok) {
        status = 'sent';
        sentTo = parsed.candidate.email;
        // Message-id Resend — clé d'interrogation de la livraison réelle. Persisté
        // (trace + journal + réponse) pour rendre /api/email/status exploitable.
        providerMessageId = sendResult.messageId;
      } else if (sendResult.error === 'email_not_configured') {
        status = 'skipped_no_config';
      } else {
        status = 'send_failed';
        sendError = sendResult.error;
      }
    } catch (err) {
      // Release GARANTI sur exception entre claim et envoi (audit C5).
      if (claimKey) await releaseOutreachClaim(claimKey);
      throw err;
    }
    if (claimKey) {
      if (status === 'sent') await confirmOutreachClaim(claimKey);
      else await releaseOutreachClaim(claimKey);
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
    providerMessageId,
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
        providerMessageId,
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
        payload: { uid: parsed.uid, mode: parsed.mode, status, providerMessageId },
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
    providerMessageId,
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
