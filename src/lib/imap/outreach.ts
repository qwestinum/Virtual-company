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
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
} from '@/lib/db/repos/imap-outreach-claims';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  getPendingValidation,
  upsertPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getSynthesisEmail } from '@/lib/email/addresses';
import { sendEmail } from '@/lib/email/client';
import { RetryablePollError } from '@/lib/imap/poll-retry';
import { uploadArtifact } from '@/lib/storage/blob';
import { queueInterviewBrief } from '@/lib/interview/queue-brief';
import { mergePendingValidationEnqueue } from '@/lib/hitl/enqueue-merge';
import {
  gateCandidateOutreach,
  type SendResult,
} from '@/lib/hitl/outreach-gate';
import type {
  DecisionZone,
  HitlDecision,
  PendingValidation,
} from '@/types/hitl';
import type { MailCandidate } from '@/types/mail-candidate';

/**
 * Levée quand l'outreach IMAP ne peut PAS confirmer l'état HITL (Supabase
 * injoignable) ni mettre en file. Remonte jusqu'à la boucle du poller pour
 * empêcher l'avancée de `last_uid_seen` au-delà de ce message : le candidat
 * sera re-fetché au prochain poll plutôt que perdu silencieusement.
 *
 * Hérite de `RetryablePollError` : le poller teste la CLASSE DE BASE — même
 * rail de gel du curseur que les échecs d'analyse re-tentables (audit C2/C3).
 */
export class RetryableOutreachError extends RetryablePollError {
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
  /**
   * Id de l'artefact CV (binaire) persisté par le poller. Rattaché à la
   * validation pour que la carte affiche « 📎 CV du candidat ». `null` si non
   * persisté (storage indisponible).
   */
  cvArtifactId: string | null;
};

export async function dispatchImapCandidateOutreach(
  input: OutreachInput,
): Promise<void> {
  const { candidate } = input;
  // HITL 3 zones (lot 2) — la ZONE pilote le gate. Repli sur `aboveThreshold`
  // pour les projections antérieures. Direction PROVISOIRE du gris = refus.
  const zone: DecisionZone =
    candidate.decisionZone ??
    (candidate.aboveThreshold ? 'auto_accept' : 'auto_reject');
  const accept = zone === 'auto_accept';
  const mode = accept ? 'invite' : 'reject';
  const decision: HitlDecision = accept ? 'accept' : 'reject';
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
  // La ZONE pilote : auto → envoi, gris → file. Gris + file non persistée →
  // 'deferred' → on N'ENVOIE RIEN et on demande le réessai (anti-perte).
  const outcome = await gateCandidateOutreach(zone, {
    send: () => composeAndSendCandidateMail({ mode, input, ownerKey }),
    enqueue: () =>
      enqueueImapPendingValidation({ mode, decision, input, ownerKey }),
  });

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

  if (outcome.kind === 'in_flight') {
    // Claim non confirmé posé par une autre passe : l'envoi est PEUT-ÊTRE en
    // cours — ni « déjà envoyé » (non prouvé) ni échec. On DIFFÈRE comme un
    // deferred : curseur gelé, le prochain poll verra un claim confirmé
    // (→ duplicate final) ou périmé (→ reprise et envoi). Audit C5 : c'est ce
    // qui remplace l'ancien « duplicate » menteur sur claim orphelin.
    await appendJournalEntry({
      action: 'imap_outreach_deferred',
      actor: 'imap_poller',
      campaignId: isTaskOwner ? null : input.campaignId,
      payload: {
        reason: 'outreach_claim_in_flight',
        mode,
        candidate: candidate.candidateName,
        uid: input.uid,
      },
    }).catch(() => {});
    throw new RetryableOutreachError('outreach_claim_in_flight');
  }

  // ─── Briefing DRH MIS EN FILE (seulement pour les acceptés RÉELLEMENT
  // contactés). Si l'invitation a été mise en file de validation ('queued'),
  // le brief sera posé à la validation humaine (via /api/scheduler dans
  // sendValidation), pas ici. Délivré au candidat à la réservation Cal.com.
  // `duplicate` = une passe concurrente a déjà envoyé l'invitation ET mis le
  // brief en file : ne pas le refaire (sinon double briefing).
  if (
    mode === 'invite' &&
    outcome.kind !== 'queued' &&
    outcome.kind !== 'duplicate'
  ) {
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

  // Zone GRISE (cette fonction n'est appelée QUE pour un gris) : AUCUNE
  // direction décidée. On NE pré-rédige PAS de brouillon (de refus NI
  // d'invitation) — la carte de validation compose le mail À LA DEMANDE quand
  // l'humain tranche. Pré-rédiger un refus laissait croire (à tort) que le
  // candidat était refusé. Le booléen de retour est décidé par CE seul write
  // (persisté ou non → le gate retombe sur 'deferred', jamais envoi à l'aveugle).
  // Id déterministe (mailbox + uid + décision) ⇒ upsert idempotent si re-polled,
  // NON DESTRUCTIF via mergePendingValidationEnqueue : une re-passe ne remplace
  // jamais un lien d'artefact non-null par null ni ne ré-ouvre un `sent`.
  const validationId = `val_imap_${input.mailboxId}_${input.uid}_${decision}`;
  const nowIso = new Date().toISOString();
  const fresh: PendingValidation = {
    id: validationId,
    campaignId: input.campaignId,
    candidateName: candidate.candidateName,
    candidateEmail: candidate.email ?? null,
    score: candidate.score,
    decision,
    cvArtifactId: input.cvArtifactId,
    reportArtifactId: input.reportArtifactId,
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: {
      uid: input.uid,
      candidate,
      jobTitle: input.jobTitle,
      summary: candidate.summary,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    decidedAt: null,
    // Enqueue auto (poller) : personne n'a encore confirmé. La confirmation
    // humaine posera decidedBy='user' + identité côté serveur.
    decidedBy: null,
    decidedByUser: null,
  };
  try {
    const existing = await getPendingValidation(validationId);
    const merged = mergePendingValidationEnqueue(existing, fresh);
    if (!merged.write) {
      // Déjà engagée (`sending`) ou tranchée (`sent`) : la validation existe
      // durablement, l'humain a la main — cette re-passe n'a rien à écrire.
      return true;
    }
    await upsertPendingValidation(merged.value);
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
      validationId,
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

  // ─── Idempotence cross-instance, claims DEUX PHASES (audit C5) ───────────
  // On RÉSERVE l'envoi (mailbox, uid, mode) juste avant `sendEmail`, on
  // CONFIRME après envoi réussi. Le verdict d'un conflit est précis :
  //   - already_sent : claim CONFIRMÉ — l'envoi a eu lieu, PROUVÉ. Final.
  //   - in_flight    : claim jeune non confirmé — une autre passe envoie
  //                    peut-être. On DIFFÈRE (l'appelant gèle le curseur) : le
  //                    prochain poll verra soit confirmé, soit périmé (reprise).
  //   - won          : ce process a la main (insert gagné ou reprise d'un
  //                    claim orphelin de crash après TTL).
  const claimKey = { mailboxId: input.mailboxId, uid: input.uid, mode } as const;
  const claimVerdict = await claimOutreach(claimKey);
  if (claimVerdict === 'already_sent') {
    await appendJournalEntry({
      action: 'imap_outreach_duplicate_skipped',
      actor: 'imap_poller',
      campaignId: campaignIdForJournal,
      payload: {
        mode,
        candidate: candidate.candidateName,
        uid: input.uid,
        taskId: taskIdForJournal ?? undefined,
        // Le journal dit ce qu'il SAIT : la réservation est CONFIRMÉE (envoi
        // prouvé par une autre passe), pas une supposition.
        reason: 'reservation_confirmee_par_une_autre_passe',
        confirmed: true,
      },
    }).catch(() => {});
    return { kind: 'duplicate' };
  }
  if (claimVerdict === 'in_flight') {
    return { kind: 'in_flight' };
  }

  let sentTo: string | null = null;
  let providerMessageId: string | null = null;
  let status:
    | 'sent'
    | 'skipped_no_email'
    | 'skipped_no_config'
    | 'send_failed' = 'skipped_no_config';
  let sendError: string | undefined;

  try {
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
  } catch (err) {
    // Release GARANTI sur exception entre claim et envoi (ex. lecture des
    // settings qui lève) — sinon claim orphelin = candidat muet (audit C5).
    // Le kill de process, lui, est couvert par le TTL + reprise.
    await releaseOutreachClaim(claimKey);
    throw err;
  }

  if (status === 'sent') {
    // Phase 2 du claim : la PREUVE « déjà envoyé » pour les passes futures.
    // Fenêtre résiduelle assumée : crash ICI (entre envoi et confirmation) ⇒
    // reprise après TTL = rare doublon — mieux qu'un candidat muet.
    await confirmOutreachClaim(claimKey);
  } else {
    // Envoi NON abouti (échec transitoire, email/config manquant) → on relâche
    // la réservation pour qu'un réessai puisse renvoyer.
    await releaseOutreachClaim(claimKey);
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
