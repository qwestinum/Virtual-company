/**
 * /api/validations/[id]/send — finalise une validation (HITL, P5).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Appelé par le client APRÈS l'envoi effectif du mail (mail-composer override
 * + scheduler pour un accept). Rôle : marquer la validation `sent` + journaliser
 * la décision (pour que les métriques la comptabilisent — P7). Idempotent.
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  getPendingValidation,
  patchPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const validation = await getPendingValidation(id);
    if (!validation) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (validation.status === 'sent') {
      return NextResponse.json({ validation }); // idempotent
    }

    // Journalise la décision RÉELLEMENT envoyée → comptabilisée au dashboard (P7).
    await appendJournalEntry({
      action: 'hitl_validation_sent',
      campaignId: validation.campaignId,
      actor: 'user',
      payload: {
        decision: validation.decision,
        candidateName: validation.candidateName,
        candidateEmail: validation.candidateEmail,
        score: validation.score,
      },
    });

    const updated = await patchPendingValidation(id, {
      status: 'sent',
      decidedAt: new Date().toISOString(),
    });
    return NextResponse.json({ validation: updated ?? validation });
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
