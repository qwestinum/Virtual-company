/**
 * /api/validations/[id]/send — finalise une validation (HITL, P5).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Appelé par le client APRÈS l'envoi effectif du mail (mail-composer override
 * + scheduler pour un accept). Rôle : marquer la validation `sent` + journaliser
 * la décision (pour que les métriques la comptabilisent — P7). Idempotent.
 */
import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import { updateCandidateAnalysisDecision } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  getPendingValidation,
  patchPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  // Message-id Resend de l'envoi candidat (optionnel) — propagé par le client
  // pour rendre la livraison vérifiable via /api/email/status. Corps tolérant
  // au vide : un POST sans corps (rétro-compat) reste valide.
  let providerMessageId: string | null = null;
  try {
    const body = (await request.json()) as { providerMessageId?: unknown };
    if (typeof body?.providerMessageId === 'string') {
      providerMessageId = body.providerMessageId;
    }
  } catch {
    // pas de corps / JSON invalide → on ignore, l'id reste null.
  }
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
        // UID de l'analyse → rattache au candidat EXACT (chaque analyse est un
        // traitement distinct, pas de fusion par email).
        uid:
          typeof validation.payload?.uid === 'string'
            ? validation.payload.uid
            : null,
        decision: validation.decision,
        candidateName: validation.candidateName,
        candidateEmail: validation.candidateEmail,
        score: validation.score,
        // Livraison vérifiable via GET /api/email/status?id=… (null si l'envoi
        // a échoué/été sauté — la décision reste enregistrée).
        providerMessageId,
      },
    });

    const updated = await patchPendingValidation(id, {
      status: 'sent',
      decidedAt: new Date().toISOString(),
    });

    // Propagation lot 2 — un humain a tranché un gris : on fige le statut FINAL
    // de l'analyse + son identité (depuis la SESSION serveur, jamais le client).
    // `decision_zone` reste 'gray' (audit « repêché par l'humain »). Best-effort.
    const uid =
      typeof validation.payload?.uid === 'string' ? validation.payload.uid : null;
    if (uid) {
      const user = await getApiUser();
      await updateCandidateAnalysisDecision({
        uid,
        campaignId: validation.campaignId,
        status: validation.decision === 'accept' ? 'accepted' : 'rejected',
        decidedByUser: user ? { userId: user.id, email: user.email ?? null } : null,
      });
    }
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
