/**
 * « Inviter » un profil du vivier depuis sa campagne — il devient une
 * candidature À PART ENTIÈRE (fix/vivier-replanif-filtres, point 1 et 1 bis).
 *
 * Ce que fait le geste, dans cet ordre :
 *   1. contrôles contre l'état RELU (campagne active, grille validée, une
 *      invitation peut partir, profil proposé et pas écarté) ;
 *   2. RÉSERVATION de la proposition (`identified` → `contacted`, un seul
 *      gagnant) — un double clic ne lance pas deux analyses ;
 *   3. le CV du vivier COPIÉ dans les artefacts de la candidature (`art_viv_*`)
 *      — le vivier garde le sien, chacun se purge de son côté ;
 *   4. UNE analyse sur la grille de la campagne (arbitrage DO : option A) ;
 *      une reprise relit celle qui a été persistée, jamais de second scoring ;
 *   5. la candidature par le chemin normal (`persistCandidateAnalysisStrict`),
 *      source `vivier`, décision HUMAINE à l'insertion, zone acceptée ;
 *   6. l'invitation par `dispatchCandidateOutreach` — le même envoi, les
 *      mêmes verrous que la relève IMAP. Zone acceptée ⇒ AUCUNE fiche de
 *      validation : l'humain vient de décider. Un mail au plus (claims).
 *
 * ─── JAMAIS DE DÉCISION EN PANNE ─────────────────────────────────────────
 * Analyse indisponible ou CV illisible ⇒ la réservation est RELÂCHÉE, le
 * profil redevient décidable, rien n'est envoyé ni créé.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { extractCVText, CVExtractError } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { canInviteForCampaign } from '@/lib/agents/server/interview-mail';
import { AnalysisUnavailableError } from '@/lib/ai/errors';
import { upsertArtifactMeta } from '@/lib/db/repos/artifacts';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getCandidateAnalysis, persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getVivierCandidate } from '@/lib/db/repos/vivier';
import {
  getPreselectionEntry,
  markContacted,
  releaseInvitation,
  retakeStaleInvitation,
} from '@/lib/db/repos/vivier-preselection';
import { CLAIM_TTL_MS } from '@/lib/db/claims-policy';
import { dispatchCandidateOutreach, RetryableOutreachError } from '@/lib/imap/outreach';
import { downloadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';
import { resolveLastAppliedJobs } from '@/lib/vivier/last-applied-job';
import { vivierAnalysisId, vivierCvArtifactId } from '@/lib/vivier/origin';
import { fdpJobTitle } from '@/types/job-post';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';
import type { VivierCandidate } from '@/types/vivier';
import type { VivierOrigin } from '@/types/vivier-origin';

/** Journalisée à la CRÉATION de la candidature (une fois). */
export const CANDIDATE_CREATED_FROM_VIVIER = 'candidate_created_from_vivier';

export type VivierInviteRefusal =
  | 'not_found'
  | 'campaign_not_active'
  | 'sheet_not_validated'
  | 'no_link'
  | 'no_email'
  | 'not_proposed'
  | 'already_decided'
  | 'in_progress'
  | 'analysis_unavailable'
  | 'cv_unreadable';

export type VivierInviteMail = 'sent' | 'duplicate' | 'send_failed' | 'skipped';

export type VivierInviteOutcome =
  | { kind: 'invited'; analysisId: string; mail: VivierInviteMail; created: boolean }
  | { kind: 'refused'; reason: VivierInviteRefusal };

export async function inviteVivierCandidate(params: {
  campaignId: string;
  vivierCandidateId: string;
  actor: { id: string | null; email: string | null };
}): Promise<VivierInviteOutcome> {
  const { campaignId, vivierCandidateId } = params;
  const refuse = (reason: VivierInviteRefusal): VivierInviteOutcome => ({ kind: 'refused', reason });

  const [campaign, candidate, entry] = await Promise.all([
    getCampaign(campaignId),
    getVivierCandidate(vivierCandidateId),
    getPreselectionEntry(campaignId, vivierCandidateId),
  ]);
  if (!campaign || !candidate) return refuse('not_found');
  if (campaign.status !== 'active') return refuse('campaign_not_active');
  const sheet = campaign.scoringSheet?.isValidated ? campaign.scoringSheet : null;
  if (!sheet) return refuse('sheet_not_validated');
  if (!candidate.email) return refuse('no_email');
  if (!entry) return refuse('not_proposed');
  if (entry.state === 'rejected') return refuse('already_decided');
  if (!(await canInviteForCampaign(campaign.id))) return refuse('no_link');

  const analysisId = vivierAnalysisId(campaignId, vivierCandidateId);
  const existing = await getCandidateAnalysis(analysisId);

  // ── Réservation : un seul passage analyse. Une candidature déjà née ⇒ on
  // reprend là où l'envoi s'est arrêté (il tient ses propres verrous).
  let reservedAt: string | null = null;
  if (!existing) {
    const actorTag = params.actor.id ? `user:${params.actor.id}` : 'user';
    if (entry.state === 'identified') {
      const won = await markContacted(campaignId, [vivierCandidateId], actorTag);
      if (won.length === 0) return refuse('in_progress');
    } else {
      // `contacted` sans candidature : une réservation en cours… ou morte.
      const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
      const retaken = entry.contactedAt
        ? await retakeStaleInvitation(campaignId, vivierCandidateId, entry.contactedAt, staleBefore, actorTag)
        : false;
      if (!retaken) return refuse(entry.contactedAt ? 'in_progress' : 'already_decided');
    }
    reservedAt = (await getPreselectionEntry(campaignId, vivierCandidateId))?.contactedAt ?? null;
  }

  const recruiter = params.actor.id ? await getRecruiter(params.actor.id).catch(() => null) : null;
  const release = async () => {
    if (reservedAt) await releaseInvitation(campaignId, vivierCandidateId, reservedAt).catch(() => {});
  };

  let application: CVApplication;
  let cvArtifactId: string | null;
  let created = false;
  if (existing) {
    application = existing.application;
    cvArtifactId = vivierCvArtifactId(analysisId);
  } else {
    try {
      const cv = await copyVivierCv(candidate, campaignId, analysisId);
      cvArtifactId = cv.artifactId;
      const origin = await buildOrigin(candidate, entry.generatedAt, recruiter?.displayName ?? null, params.actor.id);
      const analyzed = await analyzeCVApplication({
        cvText: cv.text,
        fileName: cv.fileName,
        sheet,
        source: 'vivier',
        receivedAt: origin.invitedAt,
        computedAt: origin.scoredAt,
        thresholdLow: campaign.thresholdLow,
        thresholdHigh: campaign.thresholdHigh,
      });
      application = acceptedFromVivier(analyzed.application, candidate, origin);
      const persisted = await persistCandidateAnalysisStrict({
        id: analysisId,
        uid: analysisId,
        campaignId,
        application,
        decidedBy: 'user',
        decidedByUser: params.actor.id ? { id: params.actor.id, email: params.actor.email } : undefined,
        fromVivier: { vivierCandidateId },
      });
      if (persisted === 'inserted') {
        created = true;
        await journalCreation(campaignId, analysisId, cv.fileName, application, vivierCandidateId, params.actor.id);
      }
    } catch (err) {
      await release();
      if (err instanceof AnalysisUnavailableError) return refuse('analysis_unavailable');
      if (err instanceof CVExtractError && err.code !== 'pdf_engine_unavailable') return refuse('cv_unreadable');
      throw err;
    }
  }

  // ── L'invitation : le même envoi que la relève, les mêmes verrous.
  let mail: VivierInviteMail;
  try {
    const result = await dispatchCandidateOutreach(
      {
        mailboxId: 'vivier',
        campaignId,
        jobTitle: fdpJobTitle(campaign.fdp),
        candidate: cvApplicationToMailCandidate(application),
        uid: analysisId,
        reportArtifactId: null,
        cvArtifactId,
      },
      { analysisId, claim: { mailboxId: 'vivier', uid: analysisId }, actor: 'user' },
    );
    mail =
      result.kind === 'sent' || result.kind === 'duplicate'
        ? result.kind
        : result.kind === 'send_failed'
          ? 'send_failed'
          : 'skipped';
  } catch (err) {
    // Un autre passage tient le verrou d'envoi : il enverra, pas nous.
    if (err instanceof RetryableOutreachError) mail = 'duplicate';
    else throw err;
  }
  return { kind: 'invited', analysisId, mail, created };
}

/** Le CV du vivier, COPIÉ sous la campagne. Le texte vient du vivier s'il y est. */
async function copyVivierCv(
  candidate: VivierCandidate,
  campaignId: string,
  analysisId: string,
): Promise<{ text: string; fileName: string; artifactId: string | null }> {
  const fileName = candidate.cvFileName?.trim() || `cv-${candidate.id.slice(0, 8)}.pdf`;
  const content = candidate.cvPath ? await downloadArtifact(candidate.cvPath) : null;
  let artifactId: string | null = null;
  if (content) {
    const mime = mimeOf(fileName);
    const up = await uploadArtifactBinary({
      owner: { kind: 'campaign', id: campaignId },
      name: `vivier-${candidate.id.slice(0, 8)}-${fileName}`,
      content,
      mimeType: mime,
    });
    artifactId = vivierCvArtifactId(analysisId);
    await upsertArtifactMeta({
      id: artifactId,
      campaignId,
      taskId: null,
      kind: 'cv',
      name: fileName,
      mime,
      storageBucket: up.bucket,
      storagePath: up.path,
      publicUrl: up.publicUrl,
      // `uid` : c'est par lui que la purge d'un candidat retrouve ce fichier.
      metadata: { source: 'vivier', vivierCandidateId: candidate.id, analysisId, uid: analysisId },
    });
  }
  const stored = candidate.cvText?.trim();
  if (stored) return { text: stored, fileName, artifactId };
  if (!content) throw new CVExtractError('empty_text', 'CV du vivier introuvable');
  const extracted = await extractCVText(new File([new Uint8Array(content)], fileName, { type: mimeOf(fileName) }));
  return { text: extracted.text, fileName, artifactId };
}

function mimeOf(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

async function buildOrigin(
  candidate: VivierCandidate,
  proposedAt: string | null,
  invitedByName: string | null,
  invitedById: string | null,
): Promise<VivierOrigin> {
  const now = new Date().toISOString();
  const previous = (await resolveLastAppliedJobs([candidate.email]).catch(() => new Map())).get(
    candidate.email.trim().toLowerCase(),
  );
  return {
    vivierCandidateId: candidate.id,
    cvDate: previous?.at ?? candidate.enteredAt,
    cvDateKind: previous ? 'application' : 'vivier_entry',
    previousJobTitle: previous?.jobTitle ?? null,
    proposedAt,
    scoredAt: now,
    invitedAt: now,
    invitedBy: { id: invitedById, name: invitedByName },
  };
}

/**
 * Le recruteur a décidé : zone acceptée, score et verdicts INCHANGÉS. Les
 * coordonnées sont celles du dossier vivier (dédupliqué par adresse), pas
 * celles qu'une extraction aurait lues — c'est à cette adresse qu'on écrit.
 */
export function acceptedFromVivier(
  application: CVApplication,
  candidate: Pick<VivierCandidate, 'email' | 'nom' | 'prenom' | 'telephone'>,
  origin: VivierOrigin,
): CVApplication {
  // `nom` porte souvent déjà le nom complet : on ne répète pas le prénom.
  const nom = candidate.nom.trim();
  const prenom = candidate.prenom?.trim() ?? '';
  const vivierName =
    prenom && !nom.toLowerCase().startsWith(prenom.toLowerCase()) ? `${prenom} ${nom}`.trim() : nom;
  return {
    ...application,
    candidate: {
      ...application.candidate,
      fullName: vivierName || application.candidate.fullName,
      email: candidate.email,
      phone: application.candidate.phone ?? candidate.telephone,
      source: 'vivier',
    },
    scoringResult: { ...application.scoringResult, status: 'accepted', decisionZone: 'auto_accept' },
    vivierOrigin: origin,
  };
}

/**
 * Les MÊMES actions que la relève IMAP (`imap_cv_received` + `imap_cv_analyzed`,
 * clé `uid`) — les compteurs de campagne se dérivent du journal, et sans elles
 * la candidature compterait pour zéro (piège vérifié au sourcing). Puis la
 * trace propre au vivier.
 */
async function journalCreation(
  campaignId: string,
  analysisId: string,
  fileName: string,
  application: CVApplication,
  vivierCandidateId: string,
  recruiterId: string | null,
): Promise<void> {
  const base = { uid: analysisId, fileName, candidate: application.candidate.fullName, source: 'vivier' as const };
  await appendJournalEntry({ action: 'imap_cv_received', actor: 'user', campaignId, payload: base });
  await appendJournalEntry({
    action: 'imap_cv_analyzed',
    actor: 'user',
    campaignId,
    payload: {
      ...base,
      email: application.candidate.email,
      score: application.scoringResult.totalScore,
      aboveThreshold: true,
    },
  });
  await appendJournalEntry({
    action: CANDIDATE_CREATED_FROM_VIVIER,
    actor: 'user',
    campaignId,
    payload: { uid: analysisId, analysisId, campaignId, vivierId: vivierCandidateId, recruiterId },
  }).catch(() => {});
}
