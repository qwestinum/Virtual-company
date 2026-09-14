/**
 * /api/reporting/audit/candidates/[id] — détail complet d'une analyse
 * candidat (CVApplication intégral) pour la vue critère-par-critère de
 * l'audit candidat (cf. docs/specs/reporting.md §5.3).
 */
import { NextResponse } from 'next/server';

import { getArtifactMeta } from '@/lib/db/repos/artifacts';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { findContactedProposalByEmail } from '@/lib/db/repos/vivier-preselection';
import { buildCandidateTimeline } from '@/lib/reporting/candidate-timeline';
import { unionActions } from '@/lib/reporting/journal-preload';
import {
  CANDIDATE_MARKER_ACTIONS,
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
import {
  loadStageSignals,
  STAGE_MARKER_ACTIONS,
  stageFor,
} from '@/lib/reporting/stage-signals';
import {
  extractCandidateTimelineFacts,
  TIMELINE_JOURNAL_ACTIONS,
} from '@/lib/reporting/timeline-facts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  approachIdOfAnalysis,
  sourcingCvFileArtifactId,
  sourcingStructuredCvArtifactId,
} from '@/lib/sourcing/admission';

export const runtime = 'nodejs';

/**
 * Id de l'artefact CV à partir de l'id d'analyse (conventions de persistance) :
 * chat → `art_cv_<id>` ; IMAP → `art_imap_cvfile_…` (l'id d'analyse `can_imap_…`
 * partage le suffixe mailbox+uid) ; sourcing → `art_src_cvfile_<approche>` puis
 * `art_src_cv_<approche>` (CV structuré). On NE renvoie PAS d'URL signée ici : le
 * client la demande au clic (`/api/artifacts/<id>/signed-url`, TTL court, RGPD).
 */
function cvArtifactIdsFor(analysisId: string): string[] {
  if (analysisId.startsWith('can_imap_')) return [analysisId.replace('can_imap_', 'art_imap_cvfile_')];
  // Sourcing : le CV joint par la personne d'abord, sinon le CV structuré
  // fabriqué à partir de ce qu'elle a confirmé.
  const approachId = approachIdOfAnalysis(analysisId);
  if (approachId) return [sourcingCvFileArtifactId(approachId), sourcingStructuredCvArtifactId(approachId)];
  return [`art_cv_${analysisId}`];
}

async function resolveCvArtifactId(analysisId: string): Promise<string | null> {
  for (const candidateId of cvArtifactIdsFor(analysisId)) {
    try {
      const meta = await getArtifactMeta(candidateId);
      if (meta?.storagePath) return meta.id;
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const candidate = await getCandidateAnalysis(id);
    if (!candidate) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // ── Une vague de lectures, au lieu de trois étages ─────────────────────
    //
    // Parcours, frise et étape dérivent tous du journal sur le MÊME périmètre
    // (la campagne de l'analyse) et, pour deux d'entre eux, de la file HITL :
    // on lit l'UNION des actions une fois et la file une fois, chaque
    // dérivation reprend ses actions et garde son propre repli en cas d'échec.
    // Seule la lecture vivier peut faire échouer la requête — comme avant.
    const scope = candidate.campaignId ?? undefined;
    const journalP = listJournalEntriesByActions(
      unionActions(
        CANDIDATE_MARKER_ACTIONS,
        TIMELINE_JOURNAL_ACTIONS,
        STAGE_MARKER_ACTIONS,
      ),
      { campaignId: scope },
    );
    const pendingP = listPendingValidations();
    // Annotation factuelle « issu du vivier » (§6.3), dérivée du proposal —
    // visible par le recruteur. Rapprochement EXACT par email.
    const vivierOriginP =
      candidate.campaignId && candidate.candidateEmail
        ? findContactedProposalByEmail(
            candidate.campaignId,
            candidate.candidateEmail,
          )
        : Promise.resolve(null);
    for (const p of [journalP, pendingP, vivierOriginP]) {
      void p.catch(() => undefined);
    }
    // Pièces + frise datée (niveau 3). Le CV est référencé par id (lien signé à
    // la demande). La frise croise analyse + journal + vivier + réservation.
    // `stage` = étape COURANTE (même dérivation que la liste) : le panneau/la
    // page s'en servent pour des actions à jour après chaque clic, sans
    // dépendre du snapshot de liste.
    const [signals, vivierOrigin, cvArtifactId, timelineFacts, stageSignals] =
      await Promise.all([
        // Enrichit avec le parcours dérivé du journal + file HITL (lecture seule).
        loadJourneySignals({
          campaignId: scope,
          preloaded: { journal: journalP, pending: pendingP },
        }),
        vivierOriginP,
        resolveCvArtifactId(candidate.id),
        extractCandidateTimelineFacts(candidate, vivierOriginP, {
          journal: journalP,
        }),
        loadStageSignals(
          { campaignId: scope },
          { journal: journalP, pending: pendingP },
        ),
      ]);
    const journey = journeyFromSignals(
      signals,
      candidate.uid,
      candidate.status,
      candidate.decisionZone,
      candidate.decidedBy,
      candidate.dismissedAt !== null,
    );
    const timeline = buildCandidateTimeline(timelineFacts);
    const stage = stageFor(candidate, stageSignals);
    return NextResponse.json({
      candidate: { ...candidate, journey },
      vivierOrigin,
      cvArtifactId,
      timeline,
      stage,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
