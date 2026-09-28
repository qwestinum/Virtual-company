/**
 * Message au candidat après décision — cœur SERVEUR. feat/feedback-candidat.
 *
 * Deux gestes, l'un des deux obligatoire au moment de la décision (la route
 * qui décide refuse sans lui) :
 *   - `send` : le message relu à l'écran part, SIGNÉ du recruteur (Reply-To =
 *     son adresse), mention d'information RGPD apposée par le code ;
 *   - `self` : le recruteur prévient lui-même — AUCUN envoi, le canal est tracé.
 *
 * Exactly-once : UN message par (candidature, type), verrou deux-phases de la
 * table `imap_outreach_claims` (même mécanique que l'outreach et le « sans
 * suite » — dont la clé est RÉUTILISÉE pour `sans_suite` : un seul message
 * sans suite par candidature, quel que soit le chemin). Double clic, rejeu :
 * `duplicate`, rien ne repart.
 *
 * Ordre : la ligne `pending` (le corps validé), le verrou, l'envoi, le statut.
 * Une ligne restée `pending` dit « envoi non confirmé », jamais « envoyé ».
 *
 * Ce module ne voit JAMAIS le commentaire du recruteur : il reçoit un corps
 * déjà relu, contrôlé en amont par `checkFeedbackChoice`.
 */

import {
  candidateFirstName,
  feedbackSubject,
  finalizeFeedbackText,
  recruiterFirstName,
  type FeedbackTemplateVars,
} from '@/lib/candidatures/feedback-template';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  insertPendingFeedbackMail,
  insertSelfFeedback,
  settleFeedbackMail,
} from '@/lib/db/repos/candidate-feedback';
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
  type OutreachClaimKey,
} from '@/lib/db/repos/imap-outreach-claims';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSenderEmail } from '@/lib/email/addresses';
import { sendEmail } from '@/lib/email/client';
import { interviewMailTextToHtml } from '@/lib/interview/mail-templates';
import { resolveOrganizationName } from '@/types/branding';
import type {
  FeedbackChannel,
  FeedbackChoice,
  FeedbackKind,
  FeedbackMailStatus,
} from '@/types/candidate-feedback';
import type { HumanDecider } from '@/types/hitl';
import { DEFAULT_INTERVIEW_CONFIG, type InterviewConfig } from '@/types/interview-settings';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export const FEEDBACK_RECORDED_ACTION = 'candidate_feedback_recorded';

/** Pseudo-mailbox des verrous de message après décision. */
const FEEDBACK_CLAIM_MAILBOX = 'candidate_feedback';
/** Clé du mail « sans suite » (cf. dismissal.ts) — partagée exprès. */
const DISMISSAL_CLAIM_MAILBOX = 'candidature_dismissal';

export function feedbackClaimKey(analysisId: string, kind: FeedbackKind): OutreachClaimKey {
  return kind === 'sans_suite'
    ? { mailboxId: DISMISSAL_CLAIM_MAILBOX, uid: analysisId, mode: 'dismiss' }
    : { mailboxId: FEEDBACK_CLAIM_MAILBOX, uid: analysisId, mode: kind };
}

/** Ce qu'il faut pour PROPOSER puis ENVOYER un message (hors variables libres). */
export type FeedbackContext = {
  vars: Omit<FeedbackTemplateVars, 'nextStep' | 'motif'>;
  templates: Pick<
    InterviewConfig,
    | 'feedbackRetainedTemplate'
    | 'feedbackNotRetainedTemplate'
    | 'feedbackNoShowTemplate'
    | 'feedbackDismissedTemplate'
  >;
  candidateEmail: string | null;
  /** Adresse du recruteur qui décide — les réponses arrivent chez lui. */
  replyTo: string | null;
  /** Contact de la mention RGPD (adresse de réception de la campagne). */
  rgpdContact: string;
};

async function jobTitleOf(campaignId: string | null): Promise<string> {
  if (!campaignId) return 'le poste visé';
  const campaign = await getCampaign(campaignId).catch(() => null);
  const v = campaign?.fdp.fields.job_title?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : 'le poste visé';
}

/**
 * Ce qui ne dépend que de la CAMPAGNE et du recruteur — partageable par un
 * lot (clôture, classement groupé) : une lecture pour tout le lot.
 */
export type FeedbackBase = Omit<FeedbackContext, 'candidateEmail' | 'vars'> & {
  vars: Omit<FeedbackContext['vars'], 'prenom'>;
};

export async function loadFeedbackBase(
  campaignId: string | null,
  actor: HumanDecider | null,
): Promise<FeedbackBase> {
  const [settings, jobTitle, recruiter, sender] = await Promise.all([
    getAppSettings().catch(() => null),
    jobTitleOf(campaignId),
    actor?.userId ? getRecruiter(actor.userId).catch(() => null) : Promise.resolve(null),
    getSenderEmail().catch(() => null),
  ]);
  const interview = settings?.interviewConfig;
  const reception = campaignId
    ? await resolveCampaignReceptionAddress(campaignId, settings?.intakeEmail).catch(() => null)
    : (settings?.intakeEmail ?? null);
  const recruiterName =
    recruiter?.displayName?.trim() || interview?.recruiterName?.trim() || 'L’équipe recrutement';
  return {
    vars: {
      jobTitle,
      organisation: resolveOrganizationName(settings) ?? 'L’équipe recrutement',
      recruiterFirstName: recruiterFirstName(recruiterName),
      recruiterName,
    },
    templates: {
      feedbackRetainedTemplate: interview?.feedbackRetainedTemplate ?? DEFAULT_INTERVIEW_CONFIG.feedbackRetainedTemplate,
      feedbackNotRetainedTemplate:
        interview?.feedbackNotRetainedTemplate ?? DEFAULT_INTERVIEW_CONFIG.feedbackNotRetainedTemplate,
      feedbackNoShowTemplate: interview?.feedbackNoShowTemplate ?? DEFAULT_INTERVIEW_CONFIG.feedbackNoShowTemplate,
      feedbackDismissedTemplate:
        interview?.feedbackDismissedTemplate ?? DEFAULT_INTERVIEW_CONFIG.feedbackDismissedTemplate,
    },
    replyTo: recruiter?.email ?? actor?.email ?? reception ?? null,
    rgpdContact: reception || sender || '',
  };
}

/** Le contexte d'UNE candidature, à partir de la base partagée. */
export function feedbackContextFor(
  base: FeedbackBase,
  analysis: Pick<CandidateAnalysisSummary, 'candidateName' | 'candidateEmail'>,
): FeedbackContext {
  return {
    ...base,
    vars: { ...base.vars, prenom: candidateFirstName(analysis.candidateName) },
    candidateEmail: analysis.candidateEmail,
  };
}

export async function loadFeedbackContext(
  analysis: Pick<CandidateAnalysisSummary, 'campaignId' | 'candidateName' | 'candidateEmail'>,
  actor: HumanDecider | null,
): Promise<FeedbackContext> {
  return feedbackContextFor(await loadFeedbackBase(analysis.campaignId, actor), analysis);
}

export type RecordFeedbackOutcome = {
  feedbackId: string;
  kind: FeedbackKind;
  channel: FeedbackChannel;
  /** `null` hors envoi. */
  mailStatus: FeedbackMailStatus | null;
};

/**
 * Enregistre le choix (et envoie si `send`). Le choix a été CONTRÔLÉ avant la
 * décision (`checkFeedbackChoice`) : ici on ne refuse plus, on exécute.
 * `cause` : contexte journal (ex. `not_selected_at_closure`), jamais un nom.
 */
export async function recordFeedback(args: {
  analysis: Pick<
    CandidateAnalysisSummary,
    'id' | 'uid' | 'campaignId' | 'candidateName' | 'candidateEmail'
  >;
  kind: FeedbackKind;
  choice: FeedbackChoice;
  actor: HumanDecider | null;
  cause?: string;
  context?: FeedbackContext;
}): Promise<RecordFeedbackOutcome> {
  const { analysis, kind, choice, actor } = args;
  const common = {
    analysisId: analysis.id,
    uid: analysis.uid,
    campaignId: analysis.campaignId,
    kind,
    authorUserId: actor?.userId ?? null,
    authorEmail: actor?.email ?? null,
  };

  let outcome: RecordFeedbackOutcome;
  if (choice.mode === 'self') {
    const row = await insertSelfFeedback({
      ...common,
      channel: choice.channel,
      note: choice.note?.trim() || null,
    });
    outcome = { feedbackId: row.id, kind, channel: choice.channel, mailStatus: null };
  } else {
    const ctx = args.context ?? (await loadFeedbackContext(analysis, actor));
    const subject = choice.subject.trim() || feedbackSubject(ctx.vars.jobTitle);
    const body = choice.body.trim();
    const row = await insertPendingFeedbackMail({ ...common, subject, body });
    const status = await sendOnce({ analysisId: analysis.id, kind, subject, body, ctx });
    await settleFeedbackMail(row.id, status);
    outcome = { feedbackId: row.id, kind, channel: 'mail', mailStatus: status };
  }

  // Au journal : l'identifiant de la ligne, jamais le corps ni un nom.
  await appendJournalEntry({
    action: FEEDBACK_RECORDED_ACTION,
    actor: 'user',
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      feedbackId: outcome.feedbackId,
      kind,
      channel: outcome.channel,
      mailStatus: outcome.mailStatus,
      ...(args.cause ? { cause: args.cause } : {}),
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  }).catch(() => undefined);

  return outcome;
}

async function sendOnce(args: {
  analysisId: string;
  kind: FeedbackKind;
  subject: string;
  body: string;
  ctx: FeedbackContext;
}): Promise<Exclude<FeedbackMailStatus, 'pending'>> {
  const { ctx } = args;
  if (!ctx.candidateEmail) return 'skipped_no_email';

  const key = feedbackClaimKey(args.analysisId, args.kind);
  const verdict = await claimOutreach(key);
  if (verdict === 'already_sent' || verdict === 'in_flight') return 'duplicate';

  let result;
  try {
    result = await sendEmail({
      to: ctx.candidateEmail,
      subject: args.subject,
      html: interviewMailTextToHtml(finalizeFeedbackText(args.body, ctx.rgpdContact)),
      replyTo: ctx.replyTo ?? undefined,
    });
  } catch {
    // La décision est déjà posée : une panne de transport ne la défait pas,
    // elle se DIT (statut `send_failed`, renvoi possible depuis la fiche).
    await releaseOutreachClaim(key);
    return 'send_failed';
  }
  if (result.ok) {
    await confirmOutreachClaim(key);
    return 'sent';
  }
  await releaseOutreachClaim(key);
  return result.error === 'email_not_configured' ? 'skipped_no_config' : 'send_failed';
}
