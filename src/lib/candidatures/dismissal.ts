/**
 * Cœur SERVEUR du classement sans suite — partagé par l'action individuelle,
 * la clôture de campagne et le flux GO (jamais deux implémentations).
 *
 * Protocole ordonné (concurrence maîtrisée) :
 *   1. void de la validation HITL `pending` (conditionnel) — un `sending`
 *      (envoi en cours) REFUSE le classement (`deferred_sending`) : un mail
 *      part peut-être, on ne classe pas sous incertitude ;
 *   2. classement conditionnel de l'analyse (`dismissed_at is null`, un seul
 *      gagnant, idempotent) ;
 *   3. annulation des briefs d'entretien ouverts (booking posthume bloqué) ;
 *   4. mail d'information OPTIONNEL sous claim deux-phases
 *      (`candidature_dismissal`/analysisId/`dismiss` — claim AVANT sendEmail,
 *      confirm APRÈS, release sur échec : rails identiques à l'outreach) ;
 *   5. journal honnête : `candidature_dismissed` (+ statut mail réel),
 *      `candidature_dismissal_mail_not_sent` si le mail demandé n'est pas parti.
 */

import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import {
  dismissalTextToHtml,
  renderDismissalMail,
} from '@/lib/candidatures/dismissal-template';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  dismissCandidateAnalysis,
  revertCandidateAnalysisDismissal,
} from '@/lib/db/repos/candidate-analyses';
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
} from '@/lib/db/repos/imap-outreach-claims';
import {
  cancelOpenBriefsForCandidate,
  restoreCancelledBriefsForCandidate,
} from '@/lib/db/repos/interview-briefs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listPendingValidations,
  listVoidValidations,
  unvoidPendingValidation,
  voidPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { getSenderEmail } from '@/lib/email/addresses';
import { sendEmail } from '@/lib/email/client';
import { dismissalMailAllowed, type DismissalReason } from '@/types/dismissal';
import type { DecidedBy, HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';

/** Pseudo-mailbox du claim (même table que l'outreach IMAP/HITL). */
const DISMISSAL_CLAIM_MAILBOX = 'candidature_dismissal';

export type DismissalMailStatus =
  | 'sent'
  | 'duplicate'
  | 'skipped_no_email'
  | 'skipped_no_config'
  | 'send_failed'
  | 'not_requested'
  | 'not_applicable';

export type DismissCandidatureResult =
  | { status: 'dismissed'; mailStatus: DismissalMailStatus }
  | { status: 'already_dismissed' }
  | { status: 'deferred_sending' }
  | { status: 'not_found' };

function firstName(nom: string): string {
  return nom.trim().split(/\s+/)[0] ?? nom;
}

async function jobTitleFor(campaignId: string | null): Promise<string> {
  if (!campaignId) return 'le poste visé';
  const campaign = await getCampaign(campaignId).catch(() => null);
  const v = campaign?.fdp.fields.job_title?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : 'le poste visé';
}

/**
 * Trouve la validation HITL ouverte (pending/sending) d'une candidature —
 * rapprochée par uid + campagne (même règle que les compteurs).
 */
async function findOpenValidationId(
  analysis: CandidateAnalysisSummary,
): Promise<string | null> {
  const pending = await listPendingValidations();
  const match = pending.find(
    (v) =>
      v.payload?.uid === analysis.uid &&
      (analysis.campaignId === null || v.campaignId === analysis.campaignId),
  );
  return match?.id ?? null;
}

async function sendDismissalMail(
  analysis: CandidateAnalysisSummary,
  reason: DismissalReason,
): Promise<DismissalMailStatus> {
  if (!dismissalMailAllowed(reason)) return 'not_applicable';
  if (!analysis.candidateEmail) return 'skipped_no_email';

  const settings = await getAppSettings().catch(() => null);
  const organisation =
    settings?.vivierConfig?.organisationName?.trim() ||
    DEFAULT_VIVIER_CONFIG.organisationName.trim() ||
    'L’équipe recrutement';
  const reception = analysis.campaignId
    ? await resolveCampaignReceptionAddress(
        analysis.campaignId,
        settings?.intakeEmail,
      ).catch(() => null)
    : (settings?.intakeEmail ?? null);
  const rgpdContact = reception || (await getSenderEmail().catch(() => null)) || '';

  const mail = renderDismissalMail(reason, {
    prenom: firstName(analysis.candidateName),
    jobTitle: await jobTitleFor(analysis.campaignId),
    organisation,
    rgpdContact,
  });
  if (!mail) return 'not_applicable';

  // Claim deux-phases AVANT l'envoi — un classement rejoué ne renvoie jamais.
  const claimKey = {
    mailboxId: DISMISSAL_CLAIM_MAILBOX,
    uid: analysis.id,
    mode: 'dismiss',
  } as const;
  const verdict = await claimOutreach(claimKey);
  if (verdict === 'already_sent' || verdict === 'in_flight') return 'duplicate';

  let result;
  try {
    result = await sendEmail({
      to: analysis.candidateEmail,
      subject: mail.subject,
      html: dismissalTextToHtml(mail.text),
      replyTo: reception || undefined,
    });
  } catch (err) {
    await releaseOutreachClaim(claimKey);
    throw err;
  }
  if (result.ok) {
    await confirmOutreachClaim(claimKey);
    return 'sent';
  }
  await releaseOutreachClaim(claimKey);
  return result.error === 'email_not_configured'
    ? 'skipped_no_config'
    : 'send_failed';
}

export type DismissCandidatureOptions = {
  reason: DismissalReason;
  /** Envoyer le mail d'information (le choix UI ; la matrice par raison
   * garde-fou en aval — jamais de mail doublon/invalide). */
  sendMail: boolean;
  /** 'user' = action individuelle / confirmation humaine ; 'auto' réservé aux
   * flux système futurs (aujourd'hui tous les chemins passent par un humain). */
  dismissedBy: DecidedBy;
  dismissedByUser: HumanDecider | null;
  actor: string;
};

/**
 * Classe UNE candidature sans suite (protocole complet, cf. header).
 * Idempotent : rejouer rend `already_dismissed` sans effet de bord.
 */
export async function dismissCandidature(
  analysis: CandidateAnalysisSummary,
  opts: DismissCandidatureOptions,
): Promise<DismissCandidatureResult> {
  // 1. Fermer la validation HITL ouverte AVANT le classement — la porte
  // d'envoi est verrouillée en premier (un void n'est plus réservable).
  const validationId = await findOpenValidationId(analysis);
  let voidedValidationId: string | null = null;
  if (validationId) {
    const outcome = await voidPendingValidation(validationId);
    if (outcome === 'in_flight') return { status: 'deferred_sending' };
    // `already_sent` : la décision est partie entre-temps — on classe quand
    // même (le classement domine l'étape dérivée), la trace mail existe.
    if (outcome === 'voided') voidedValidationId = validationId;
  }

  // 2. Classement conditionnel (un seul gagnant).
  const outcome = await dismissCandidateAnalysis({
    analysisId: analysis.id,
    reason: opts.reason,
    dismissedBy: opts.dismissedBy,
    dismissedByUser: opts.dismissedByUser,
  });
  if (outcome === 'not_found') return { status: 'not_found' };
  if (outcome === 'already_dismissed') return { status: 'already_dismissed' };

  // 3. Briefs d'entretien : annulation best-effort (un échec ne doit pas
  // annuler le classement déjà posé — signalé au journal via mailStatus).
  try {
    await cancelOpenBriefsForCandidate({
      uid: analysis.uid,
      campaignId: analysis.campaignId,
      email: analysis.candidateEmail,
    });
  } catch (err) {
    console.error('[dismissal] cancelOpenBriefsForCandidate failed', err);
  }

  // 4. Mail d'information (optionnel, sous claim).
  let mailStatus: DismissalMailStatus = 'not_requested';
  if (opts.sendMail) {
    try {
      mailStatus = await sendDismissalMail(analysis, opts.reason);
    } catch (err) {
      console.error('[dismissal] mail send threw', err);
      mailStatus = 'send_failed';
    }
  }

  // 5. Journal honnête.
  await appendJournalEntry({
    action: 'candidature_dismissed',
    actor: opts.actor,
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      candidateName: analysis.candidateName,
      candidateEmail: analysis.candidateEmail,
      reason: opts.reason,
      voidedValidationId,
      mailStatus,
      mailSent: mailStatus === 'sent' || mailStatus === 'duplicate',
    },
  });
  if (opts.sendMail && mailStatus !== 'sent' && mailStatus !== 'duplicate') {
    await appendJournalEntry({
      action: 'candidature_dismissal_mail_not_sent',
      actor: opts.actor,
      campaignId: analysis.campaignId,
      payload: {
        uid: analysis.uid,
        analysisId: analysis.id,
        candidateName: analysis.candidateName,
        candidateEmail: analysis.candidateEmail,
        reason: opts.reason,
        mailStatus,
      },
    });
  }

  return { status: 'dismissed', mailStatus };
}

export type ReopenResult = 'reopened' | 'not_dismissed';

/**
 * Rouvre une candidature classée par ERREUR : lève le classement, restaure la
 * validation voidée et les briefs annulés. Le mail d'information déjà parti ne
 * se dé-envoie pas (rappelé côté UI) — le claim confirmé reste en place, un
 * futur re-classement ne RE-enverra donc pas de mail (voulu).
 */
export async function reopenCandidature(
  analysis: CandidateAnalysisSummary,
  actor: string,
): Promise<ReopenResult> {
  const outcome = await revertCandidateAnalysisDismissal(analysis.id);
  if (outcome === 'not_dismissed') return 'not_dismissed';

  // Restaurations best-effort : la réouverture de l'analyse est le fait
  // principal ; le reste se répare à la main si un hoquet survient (journalisé).
  let restoredValidation = false;
  try {
    const validationId = await findVoidValidationId(analysis);
    if (validationId) {
      restoredValidation =
        (await unvoidPendingValidation(validationId)) === 'restored';
    }
  } catch (err) {
    console.error('[dismissal] unvoid failed', err);
  }
  try {
    await restoreCancelledBriefsForCandidate({ uid: analysis.uid });
  } catch (err) {
    console.error('[dismissal] brief restore failed', err);
  }

  await appendJournalEntry({
    action: 'candidature_dismissal_reverted',
    actor,
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      candidateName: analysis.candidateName,
      restoredValidation,
    },
  });
  return 'reopened';
}

/** Validation `void` de la candidature (pour la réouverture) — par uid. */
async function findVoidValidationId(
  analysis: CandidateAnalysisSummary,
): Promise<string | null> {
  const voided = await listVoidValidations();
  const match = voided.find(
    (v) =>
      v.payload?.uid === analysis.uid &&
      (analysis.campaignId === null || v.campaignId === analysis.campaignId),
  );
  return match?.id ?? null;
}
