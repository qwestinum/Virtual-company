/**
 * /api/reporting/audit/candidates/[id] — détail complet d'une analyse
 * candidat (CVApplication intégral) pour la vue critère-par-critère de
 * l'audit candidat (cf. docs/specs/reporting.md §5.3).
 */
import { NextResponse } from 'next/server';

import { getArtifactMeta } from '@/lib/db/repos/artifacts';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { findContactedProposalByEmail } from '@/lib/db/repos/vivier-preselection';
import { buildCandidateTimeline } from '@/lib/reporting/candidate-timeline';
import {
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import { extractCandidateTimelineFacts } from '@/lib/reporting/timeline-facts';
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
    // Enrichit avec le parcours dérivé du journal + file HITL (lecture seule).
    const signals = await loadJourneySignals({
      campaignId: candidate.campaignId ?? undefined,
    });
    const journey = journeyFromSignals(
      signals,
      candidate.uid,
      candidate.status,
      candidate.decisionZone,
      candidate.decidedBy,
      candidate.dismissedAt !== null,
    );
    // Annotation factuelle « issu du vivier » (§6.3), dérivée du proposal —
    // visible par le recruteur. Rapprochement EXACT par email.
    const vivierOrigin =
      candidate.campaignId && candidate.candidateEmail
        ? await findContactedProposalByEmail(
            candidate.campaignId,
            candidate.candidateEmail,
          )
        : null;
    // Pièces + frise datée (niveau 3). Le CV est référencé par id (lien signé à
    // la demande). La frise croise analyse + journal + vivier + réservation.
    // `stage` = étape COURANTE (même dérivation que la liste) : le panneau/la
    // page s'en servent pour des actions à jour après chaque clic, sans
    // dépendre du snapshot de liste.
    const [cvArtifactId, timelineFacts, stageSignals] = await Promise.all([
      resolveCvArtifactId(candidate.id),
      extractCandidateTimelineFacts(candidate, vivierOrigin),
      loadStageSignals({ campaignId: candidate.campaignId ?? undefined }),
    ]);
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
