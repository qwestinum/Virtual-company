/**
 * `admitSourcedCandidate` — une personne approchée a répondu : elle devient
 * une candidature ORDINAIRE. Spec : docs/specs/sourcing.md §10.
 *
 * Appelée sur une approche déjà RÉSERVÉE (`admission_pending`, saisie
 * conservée), par la route de soumission puis, en cas de panne, par le rail de
 * drain. Chaque étape est rejouable : l'analyse persistée est relue au lieu
 * d'être refaite, l'artefact est upserté, l'envoi tient ses verrous
 * deux-phases, et la fin de l'admission est conditionnelle.
 *
 * ─── JAMAIS DE DÉCISION EN PANNE ─────────────────────────────────────────
 * Une analyse indisponible laisse l'approche en attente et la personne voit
 * « bien reçue ». Rien n'est envoyé, rien n'est décidé ; le rail reprend.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { extractCVText, CVExtractError } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { canInviteForCampaign } from '@/lib/agents/server/interview-mail';
import { upsertArtifactMeta } from '@/lib/db/repos/artifacts';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getCandidateAnalysis, persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import {
  completeAdmission,
  recordAdmissionFailure,
  releaseSubmission,
  settleManifestedProfile,
  type LandingApproach,
} from '@/lib/db/repos/sourcing-admission';
import { dispatchCandidateOutreach } from '@/lib/imap/outreach';
import {
  forceAcceptedApplication,
  sourcingAnalysisId,
  sourcingCvFileArtifactId,
  sourcingStructuredCvArtifactId,
} from '@/lib/sourcing/admission';
import { buildStructuredCvText } from '@/lib/sourcing/landing';
import { renderStructuredCvPdf } from '@/lib/sourcing/server/structured-cv-pdf';
import { downloadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';
import { matchVivierApplication } from '@/lib/vivier/match-application';
import { feedVivierFromApplication } from '@/lib/vivier/ingest-application';
import { fdpJobTitle } from '@/types/job-post';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

export type AdmissionOutcome =
  | { kind: 'admitted'; analysisId: string; recruiterName: string | null }
  | { kind: 'closed' }
  | { kind: 'deferred'; cause: string };

type CvMaterial = { text: string; content: Buffer; mime: string; fileName: string; artifactId: string };

export async function admitSourcedCandidate(approach: LandingApproach): Promise<AdmissionOutcome> {
  const submission = approach.submission;
  if (approach.status !== 'admission_pending' || !submission) return { kind: 'deferred', cause: 'not_pending' };
  const analysisId = sourcingAnalysisId(approach.id);

  // ── Garde : l'offre est-elle encore ouverte, et une invitation peut-elle partir ?
  const campaign = await getCampaign(approach.campaignId);
  const sheet = campaign?.scoringSheet?.isValidated ? campaign.scoringSheet : null;
  if (!campaign || campaign.status !== 'active' || !sheet || !(await canInviteForCampaign(campaign.id))) {
    await releaseSubmission(approach.id);
    await appendJournalEntry({
      action: 'sourcing_admission_refused',
      actor: 'sourcing',
      campaignId: approach.campaignId,
      payload: { approachId: approach.id, campaignStatus: campaign?.status ?? null, scoringSheetValidated: Boolean(sheet) },
    }).catch(() => {});
    return { kind: 'closed' };
  }

  const recruiter = await getRecruiter(approach.recruiterId).catch(() => null);

  try {
    const submittedAt = approach.submittedAt ?? new Date().toISOString();
    const cv = await materializeCv(approach, campaign.id, submittedAt);

    // ── Une analyse, une seule : une reprise relit celle qui a été persistée.
    const existing = await getCandidateAnalysis(analysisId);
    let application: CVApplication;
    if (existing) {
      application = existing.application;
    } else {
      const analyzed = await analyzeCVApplication({
        cvText: cv.text,
        fileName: cv.fileName,
        sheet,
        source: 'sourcing',
        receivedAt: submittedAt,
        computedAt: new Date().toISOString(),
        thresholdLow: campaign.thresholdLow,
        thresholdHigh: campaign.thresholdHigh,
      });
      application = forceAcceptedApplication(analyzed.application, submission);
      const persisted = await persistCandidateAnalysisStrict({
        id: analysisId,
        uid: analysisId,
        campaignId: campaign.id,
        application,
        decidedBy: 'user',
        decidedByUser: { id: approach.recruiterId, email: recruiter?.email ?? null },
      });
      if (persisted === 'inserted') await journalReceivedAndAnalyzed(campaign.id, analysisId, cv.fileName, application, approach.id);
    }

    void feedVivierFromApplication({ application, cvText: cv.text, cvContent: cv.content, cvMimeType: cv.mime });
    void matchVivierApplication(campaign.id, application.candidate.email, analysisId);

    const candidate = {
      ...cvApplicationToMailCandidate(application),
      sourcingApproach: recruiter ? { recruiterName: recruiter.displayName, approachedAt: approach.initiatedAt } : undefined,
    };
    await dispatchCandidateOutreach(
      {
        mailboxId: 'sourcing',
        campaignId: campaign.id,
        jobTitle: fdpJobTitle(campaign.fdp),
        candidate,
        uid: analysisId,
        reportArtifactId: null,
        cvArtifactId: cv.artifactId,
      },
      { analysisId, claim: { mailboxId: 'sourcing', uid: approach.id }, validationPrefix: `val_src_${approach.id}`, actor: 'sourcing' },
    );

    const won = await completeAdmission(approach.id, analysisId);
    await settleManifestedProfile(approach);
    // Terminée par un autre passage : la candidature existe, le journal aussi.
    if (!won) return { kind: 'admitted', analysisId, recruiterName: recruiter?.displayName ?? null };
    await appendJournalEntry({
      action: 'sourcing_candidate_manifested',
      actor: 'sourcing',
      campaignId: campaign.id,
      payload: { approachId: approach.id, analysisId, campaignId: campaign.id, recruiterId: approach.recruiterId, channel: approach.channel, uid: analysisId },
    }).catch(() => {});
    return { kind: 'admitted', analysisId, recruiterName: recruiter?.displayName ?? null };
  } catch (err) {
    const cause = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await recordAdmissionFailure(approach, cause).catch(() => {});
    await appendJournalEntry({
      action: 'sourcing_admission_deferred',
      actor: 'sourcing',
      campaignId: approach.campaignId,
      payload: { approachId: approach.id, cause: err instanceof Error ? err.name : 'unknown', attempt: approach.admissionAttempts + 1 },
    }).catch(() => {});
    return { kind: 'deferred', cause };
  }
}

/**
 * Le CV que l'analyse lira. Joint et lisible ⇒ lui. Absent, ou illisible pour
 * une raison PROUVÉE du document ⇒ CV structuré de ce que la personne a
 * confirmé. Un moteur PDF indisponible n'est pas un défaut du document : ça
 * lève, et le rail reprend.
 */
async function materializeCv(approach: LandingApproach, campaignId: string, submittedAt: string): Promise<CvMaterial> {
  const submission = approach.submission!;
  if (submission.cv) {
    const content = await downloadArtifact(submission.cv.storagePath);
    if (!content) throw new Error('cv_download_failed');
    try {
      const extracted = await extractCVText(new File([new Uint8Array(content)], submission.cv.fileName, { type: submission.cv.mime }));
      const artifactId = sourcingCvFileArtifactId(approach.id);
      await upsertArtifactMeta({
        id: artifactId,
        campaignId,
        taskId: null,
        kind: 'cv',
        name: submission.cv.fileName,
        mime: submission.cv.mime,
        storageBucket: submission.cv.bucket,
        storagePath: submission.cv.storagePath,
        publicUrl: null,
        metadata: { source: 'sourcing', approachId: approach.id },
      });
      return { text: extracted.text, content, mime: submission.cv.mime, fileName: submission.cv.fileName, artifactId };
    } catch (err) {
      if (!(err instanceof CVExtractError) || err.code === 'pdf_engine_unavailable') throw err;
    }
  }

  const text = buildStructuredCvText(submission, submittedAt);
  const content = await renderStructuredCvPdf(text);
  const fileName = `cv-${approach.id.slice(0, 8)}.pdf`;
  const artifactId = sourcingStructuredCvArtifactId(approach.id);
  const up = await uploadArtifactBinary({ owner: { kind: 'campaign', id: campaignId }, name: `sourcing-${fileName}`, content, mimeType: 'application/pdf' });
  await upsertArtifactMeta({
    id: artifactId,
    campaignId,
    taskId: null,
    kind: 'cv',
    name: fileName,
    mime: 'application/pdf',
    storageBucket: up.bucket,
    storagePath: up.path,
    publicUrl: up.publicUrl,
    metadata: { source: 'sourcing', approachId: approach.id, structured: true },
  });
  return { text, content, mime: 'application/pdf', fileName, artifactId };
}

/**
 * Les MÊMES actions que la relève IMAP et l'upload chat (`imap_cv_received` +
 * `imap_cv_analyzed`, clé `uid`) : les compteurs de campagne (CV reçus,
 * shortlistés, invités, score moyen) et la liste du Bureau se DÉRIVENT du
 * journal. Sans elles, une candidature sourcing existait en base mais comptait
 * pour zéro, et son invitation ne se rattachait à personne. Écrites une seule
 * fois, à l'insertion de l'analyse, avant l'envoi.
 */
async function journalReceivedAndAnalyzed(
  campaignId: string,
  analysisId: string,
  fileName: string,
  application: CVApplication,
  approachId: string,
): Promise<void> {
  const base = { uid: analysisId, fileName, candidate: application.candidate.fullName, source: 'sourcing' as const, approachId };
  await appendJournalEntry({ action: 'imap_cv_received', actor: 'sourcing', campaignId, payload: base });
  await appendJournalEntry({
    action: 'imap_cv_analyzed',
    actor: 'sourcing',
    campaignId,
    payload: {
      ...base,
      email: application.candidate.email,
      score: application.scoringResult.totalScore,
      aboveThreshold: application.scoringResult.status === 'accepted',
    },
  });
}
