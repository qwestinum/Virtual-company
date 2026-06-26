/**
 * /api/validations — file des validations suspendues (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * GET  : liste les validations en attente (status = 'pending').
 * POST : crée une validation suspendue (appelé par le gating quand une section
 *        HITL est activée — le mail est rédigé en brouillon, l'envoi différé).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  listPendingValidations,
  listSentValidations,
  upsertPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { HitlDecisionSchema, type PendingValidation } from '@/types/hitl';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  // ?status=sent → historique consultable (lot 2d) ; défaut = file en attente.
  const status = new URL(request.url).searchParams.get('status');
  try {
    const validations =
      status === 'sent'
        ? await listSentValidations()
        : await listPendingValidations();
    return NextResponse.json({ validations });
  } catch (err) {
    console.error('[api/validations] GET failed', err);
    return NextResponse.json({ validations: [] });
  }
}

const CreateSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  candidateName: z.string().min(1),
  candidateEmail: z.string().nullable(),
  score: z.number().int().nullable(),
  decision: HitlDecisionSchema,
  cvArtifactId: z.string().nullable().optional(),
  reportArtifactId: z.string().nullable().optional(),
  mailDraftArtifactId: z.string().nullable().optional(),
  // L2 : `uid` (de l'analyse) OBLIGATOIRE dans le payload — c'est la clé de
  // rapprochement métrique (exclusion + override d'issue). Le reste passe libre.
  payload: z.object({ uid: z.string().min(1) }).passthrough(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof CreateSchema>;
  try {
    parsed = CreateSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const validation: PendingValidation = {
    id: parsed.id,
    campaignId: parsed.campaignId,
    candidateName: parsed.candidateName,
    candidateEmail: parsed.candidateEmail,
    score: parsed.score,
    decision: parsed.decision,
    cvArtifactId: parsed.cvArtifactId ?? null,
    reportArtifactId: parsed.reportArtifactId ?? null,
    mailDraftArtifactId: parsed.mailDraftArtifactId ?? null,
    confirmed: false,
    status: 'pending',
    payload: parsed.payload,
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    // Personne n'a encore confirmé à l'enqueue (la confirmation humaine
    // posera decidedBy='user' + identité, côté serveur).
    decidedBy: null,
    decidedByUser: null,
  };

  try {
    const saved = await upsertPendingValidation(validation);
    return NextResponse.json({ validation: saved });
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
