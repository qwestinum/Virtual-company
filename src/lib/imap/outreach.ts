/**
 * Orchestration outreach pour les CVs reçus par IMAP
 * (Session 5 round 5 — fix : le poller n'envoyait jamais de mail
 * refus/invitation, c'était limité au chemin upload manuel).
 *
 * Pour un candidat analysé par le poller :
 *   - sous seuil → mail de refus envoyé au candidat
 *   - au-dessus  → mail d'acceptation+invitation (template + lien d'agenda) au
 *                  candidat + briefing d'entretien MIS EN FILE (délivré au DRH
 *                  à la réservation Cal.com, cf. src/lib/interview/queue-brief.ts)
 *
 * Les messages candidat sont rendus de manière déterministe
 * (`buildInterviewMail`, plus de LLM) ; la trame DRH reste générée puis mise en
 * attente. Service email Resend. Toutes les erreurs sont capturées et loggées
 * dans le journal — un mail raté ne tue pas le poller, le DRH retrouve la trace
 * dans la table journal et l'artefact texte dans Storage.
 *
 * Différent du flux client `dispatchPostAnalysisOutreach` :
 *   - pas de bulles chat (le DRH n'est pas forcément sur la
 *     campagne au moment du poll)
 *   - pas de hydrateArtifact côté store (on est serveur, le store
 *     se rechargera via /api/artifacts au prochain refresh)
 *   - sequentialité par candidat (un seul CV par appel)
 */

import {
  buildInterviewMail,
  getResolvedAgendaLink,
} from '@/lib/agents/server/interview-mail';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { upsertPendingValidation } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getSynthesisEmail } from '@/lib/email/addresses';
import { sendEmail } from '@/lib/email/client';
import { uploadArtifact } from '@/lib/storage/blob';
import { queueInterviewBrief } from '@/lib/interview/queue-brief';
import {
  gateCandidateOutreach,
  type SendResult,
} from '@/lib/hitl/outreach-gate';
import type { HitlDecision } from '@/types/hitl';
import type { MailCandidate } from '@/types/mail-candidate';

/**
 * Levée quand l'outreach IMAP ne peut PAS confirmer l'état HITL (Supabase
 * injoignable) ni mettre en file. Remonte jusqu'à la boucle du poller pour
 * empêcher l'avancée de `last_uid_seen` au-delà de ce message : le candidat
 * sera re-fetché au prochain poll plutôt que perdu silencieusement.
 */
export class RetryableOutreachError extends Error {
  constructor(public readonly reason: string) {
    super(`retryable_outreach: ${reason}`);
    this.name = 'RetryableOutreachError';
  }
}

export type OutreachInput = {
  mailboxId: string;
  campaignId: string;
  jobTitle: string | null;
  candidate: MailCandidate;
  /** UID IMAP du message d'origine, pour traçabilité dans le journal. */
  uid: string;
  /**
   * Id de l'artefact « rapport d'analyse » (cv_report) déjà généré + persisté
   * par le poller. Rattaché à la validation pour que la carte affiche le bouton
   * « 📄 Rapport d'analyse » (parité avec le chemin chat). `null` si non produit.
   */
  reportArtifactId: string | null;
};

export async function dispatchImapCandidateOutreach(
  input: OutreachInput,
): Promise<void> {
  const { candidate } = input;
  const mode = candidate.aboveThreshold ? 'invite' : 'reject';
  const decision: HitlDecision = candidate.aboveThreshold ? 'accept' : 'reject';
  const isTaskOwner = input.campaignId.startsWith('TASK-');
  const ownerKey = isTaskOwner
    ? { taskId: input.campaignId }
    : { campaignId: input.campaignId };

  // Lien d'agenda obligatoire en mode invite (réglage org-level, repli env).
  // Absent ⇒ on logue et on n'envoie NI l'acceptation NI le brief (mais on ne
  // plante pas le poller). Le refus, lui, ne dépend pas du lien. (Inchangé,
  // hors périmètre du gating HITL.)
  const agendaLink = await getResolvedAgendaLink();
  if (mode === 'invite' && !agendaLink) {
    await appendJournalEntry({
      action: 'imap_outreach_skipped',
      actor: 'imap_poller',
      campaignId: isTaskOwner ? null : input.campaignId,
      payload: {
        reason: 'agenda_link_not_configured',
        candidate: candidate.candidateName,
        uid: input.uid,
      },
    });
    return;
  }

  // ─── Décision HITL (règle PARTAGÉE avec le chemin chat) ────────────────
  // onUnconfirmed: 'defer' → si l'état HITL est illisible (Supabase down) ou
  // si la file ne persiste pas, on N'ENVOIE RIEN et on demande le réessai.
  const outcome = await gateCandidateOutreach(
    decision,
    {
      loadHitlConfig: async () => (await getAppSettings())?.hitlConfig ?? null,
      send: () => composeAndSendCandidateMail({ mode, input, ownerKey }),
      enqueue: () =>
        enqueueImapPendingValidation({ mode, decision, input, ownerKey }),
    },
    { onUnconfirmed: 'defer' },
  );

  if (outcome.kind === 'deferred') {
    await appendJournalEntry({
      action: 'imap_outreach_deferred',
      actor: 'imap_poller',
      campaignId: isTaskOwner ? null : input.campaignId,
      payload: {
        reason: outcome.reason,
        mode,
        candidate: candidate.candidateName,
        uid: input.uid,
      },
    }).catch(() => {});
    // Remonte : la boucle du poller ne doit pas marquer ce message comme vu.
    throw new RetryableOutreachError(outcome.reason);
  }

  // ─── Briefing DRH MIS EN FILE (seulement pour les acceptés RÉELLEMENT
  // contactés). Si l'invitation a été mise en file de validation ('queued'),
  // le brief sera posé à la validation humaine (via /api/scheduler dans
  // sendValidation), pas ici. Délivré au candidat à la réservation Cal.com.
  if (mode === 'invite' && outcome.kind !== 'queued') {
    await queueInterviewBrief({
      campaignId: input.campaignId,
      jobTitle: input.jobTitle,
      candidate: input.candidate,
      actor: 'imap_poller',
      uid: input.uid,
    });
  }
}

/**
 * HITL — compose le mail en BROUILLON (sans envoyer) et crée une validation
 * suspendue PERSISTÉE. L'envoi (et le brief pour un accept) est différé jusqu'à
 * la validation humaine (`sendValidation`). Symétrique de
 * `enqueuePendingValidation` du chemin chat, mais 100% serveur (repos directs,
 * pas de fetch HTTP interne).
 *
 * Retourne `true` si la validation a été persistée durablement, `false` sinon
 * (Supabase injoignable / write KO) — le gate traduit alors `false` en
 * `deferred` (réessai), jamais en envoi silencieux.
 */
async function enqueueImapPendingValidation(args: {
  mode: 'invite' | 'reject';
  decision: HitlDecision;
  input: OutreachInput;
  ownerKey: { campaignId: string } | { taskId: string };
}): Promise<boolean> {
  const { mode, decision, input } = args;
  const { candidate } = input;
  const isTaskOwner = 'taskId' in args.ownerKey;
  const campaignIdForJournal = isTaskOwner ? null : input.campaignId;
  const taskIdForJournal = isTaskOwner ? input.campaignId : null;

  // 1. Brouillon du mail (composé, persisté pour la carte, PAS envoyé).
  let composed: { subject: string; html: string };
  try {
    const out = await buildInterviewMail({
      mode,
      candidate,
      jobTitle: input.jobTitle,
      campaignId: input.campaignId,
    });
    composed = out.mail;
  } catch (err) {
    await appendJournalEntry({
      action: 'imap_outreach_failed',
      actor: 'imap_poller',
      campaignId: campaignIdForJournal,
      payload: {
        stage: 'compose_draft',
        mode,
        candidate: candidate.candidateName,
        uid: input.uid,
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});
    // Pas de brouillon → on ne peut pas mettre en file proprement → defer.
    return false;
  }

  // 2. Artefact brouillon (best-effort — sa perte n'empêche pas la file ;
  //    la carte recompose depuis le template au besoin).
  const fileName = `${mode === 'reject' ? 'refus' : 'invitation'}-brouillon-${slug(candidate.candidateName)}-${input.uid}.md`;
  const artifactId = `art_imap_draft_${input.uid}_${mode}_${Math.random().toString(36).slice(2, 6)}`;
  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  let draftPersisted = false;
  try {
    const upload = await uploadArtifact({
      owner: isTaskOwner
        ? { kind: 'task', id: input.campaignId }
        : { kind: 'campaign', id: input.campaignId },
      name: fileName,
      content: renderDraftTrace({
        mode,
        candidate,
        jobTitle: input.jobTitle,
        campaignId: input.campaignId,
        subject: composed.subject,
        html: composed.html,
      }),
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
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
        draft: true,
        candidate: candidate.candidateName,
        candidateEmail: candidate.email,
        uid: input.uid,
      },
    });
    draftPersisted = true;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] draft artifact failed', err);
    }
  }

  // 3. Validation suspendue PERSISTÉE — c'est CE write qui décide du booléen.
  //    Id déterministe (mailbox + uid + décision) ⇒ upsert idempotent si le
  //    message est re-polled après une panne.
  const nowIso = new Date().toISOString();
  try {
    await upsertPendingValidation({
      id: `val_imap_${input.mailboxId}_${input.uid}_${decision}`,
      campaignId: input.campaignId,
      candidateName: candidate.candidateName,
      candidateEmail: candidate.email ?? null,
      score: candidate.score,
      decision,
      cvArtifactId: null,
      reportArtifactId: input.reportArtifactId,
      mailDraftArtifactId: draftPersisted ? artifactId : null,
      confirmed: false,
      status: 'pending',
      payload: {
        uid: input.uid,
        candidate,
        jobTitle: input.jobTitle,
        summary: candidate.summary,
        mailDraftUrl: publicUrl,
        mailSubject: composed.subject,
        mailBody: composed.html,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      decidedAt: null,
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-outreach] enqueue pending failed', err);
    }
    // Non persisté → le gate retombe sur 'deferred' (réessai), jamais envoi.
    return false;
  }

  await appendJournalEntry({
    action: 'imap_outreach_pending',
    actor: 'imap_poller',
    campaignId: campaignIdForJournal,
    payload: {
      mode,
      decision,
      candidate: candidate.candidateName,
      candidateEmail: candidate.email,
      uid: input.uid,
      validationId: `val_imap_${input.mailboxId}_${input.uid}_${decision}`,
      taskId: taskIdForJournal ?? undefined,
    },
  }).catch(() => {});

  return true;
}

async function composeAndSendCandidateMail(args: {
  mode: 'reject' | 'invite';
  input: OutreachInput;
  ownerKey: { campaignId: string } | { taskId: string };
}): Promise<SendResult> {
  const { mode, input, ownerKey } = args;
  const { candidate } = input;
  const isTaskOwner = 'taskId' in ownerKey;
  const campaignIdForJournal = isTaskOwner ? null : input.campaignId;
  const taskIdForJournal = isTaskOwner ? input.campaignId : null;

  let composed: { subject: string; html: string };
  try {
    // Rendu déterministe du template configuré (acceptation ou refus). Le lien
    // d'agenda a déjà été vérifié en amont pour une acceptation.
    const out = await buildInterviewMail({
      mode,
      candidate,
      jobTitle: input.jobTitle,
      campaignId: input.campaignId,
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
    return { kind: 'send_failed', reason: 'compose_failed' };
  }

  let sentTo: string | null = null;
  let providerMessageId: string | null = null;
  let status:
    | 'sent'
    | 'skipped_no_email'
    | 'skipped_no_config'
    | 'send_failed' = 'skipped_no_config';
  let sendError: string | undefined;

  if (!candidate.email) {
    status = 'skipped_no_email';
  } else {
    const synthesisAddress = await getSynthesisEmail();
    const sendResult = await sendEmail({
      to: candidate.email,
      subject: composed.subject,
      html: composed.html,
      replyTo: synthesisAddress || undefined,
    });
    if (sendResult.ok) {
      status = 'sent';
      sentTo = candidate.email;
      providerMessageId = sendResult.messageId;
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
    providerMessageId,
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
      providerMessageId,
      artifactId,
      publicUrl,
      uid: input.uid,
      error: sendError,
      taskId: taskIdForJournal ?? undefined,
    },
  });

  // Projection du statut interne → SendResult (contrat du gate partagé).
  switch (status) {
    case 'sent':
      return { kind: 'sent' };
    case 'skipped_no_email':
      return { kind: 'skipped', reason: 'no_email' };
    case 'skipped_no_config':
      return { kind: 'skipped', reason: 'no_config' };
    case 'send_failed':
      return { kind: 'send_failed', reason: sendError ?? 'unknown' };
  }
}


// ─── Helpers de rendu (markdown + HTML email) ─────────────────────────

/** Trace markdown d'un mail mis EN ATTENTE de validation (pas encore envoyé). */
function renderDraftTrace(args: {
  mode: 'reject' | 'invite';
  candidate: MailCandidate;
  jobTitle: string | null;
  campaignId: string;
  subject: string;
  html: string;
}): string {
  return [
    `# Brouillon ${args.mode === 'reject' ? 'de refus' : "d'invitation"} — ${args.candidate.candidateName}`,
    '',
    `Statut : **en attente de validation humaine (HITL)**`,
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

function renderMailTrace(args: {
  mode: 'reject' | 'invite';
  candidate: MailCandidate;
  jobTitle: string | null;
  campaignId: string;
  subject: string;
  html: string;
  sentTo: string | null;
  status: 'sent' | 'skipped_no_email' | 'skipped_no_config' | 'send_failed';
  sendError?: string;
  providerMessageId?: string | null;
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
    args.providerMessageId
      ? `Resend message-id : ${args.providerMessageId} (statut livraison : GET /api/email/status?id=${args.providerMessageId})`
      : '',
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
