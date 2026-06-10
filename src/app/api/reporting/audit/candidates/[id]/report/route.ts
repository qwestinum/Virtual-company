/**
 * /api/reporting/audit/candidates/[id]/report — génère et renvoie le PDF
 * d'audit candidat en téléchargement (cf. docs/specs/reporting.md §5.3).
 *
 * Pas de cache stable sur les audits : chaque appel régénère le PDF avec
 * l'horodatage de génération courant.
 */
import { NextResponse } from 'next/server';

import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { auditCandidatFileName } from '@/lib/reporting/audit-display';
import { renderCandidateAuditPdf } from '@/lib/reporting/candidate-audit-pdf';
import {
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const detail = await getCandidateAnalysis(id);
    if (!detail) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const signals = await loadJourneySignals({
      campaignId: detail.campaignId ?? undefined,
    });
    const journey = journeyFromSignals(
      signals,
      detail.uid,
      detail.status,
      detail.hitlConfig,
    );
    const generatedAtIso = new Date().toISOString();
    const pdf = await renderCandidateAuditPdf({
      detail: { ...detail, journey },
      generatedAtIso,
      campaignLabel: detail.campaignId
        ? `Campagne ${detail.campaignId}`
        : 'Hors campagne',
    });
    const fileName = auditCandidatFileName(detail.candidateName, generatedAtIso);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'pdf_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
