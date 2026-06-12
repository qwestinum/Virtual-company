/**
 * /api/campaigns/[id]/vivier-preselection — présélection vivier (Session V2, §4).
 *
 *   POST  : exécute la cascade de présélection pour la campagne.
 *           - corps `{ freeText?: string }` :
 *               • absent/vide ⇒ présélection FICHE, PERSISTÉE (idempotente,
 *                 préserve les décisions). Sert l'activation ET la relance.
 *               • présent     ⇒ recherche libre, ÉPHÉMÈRE (non persistée).
 *   GET   : relit la short-list persistée (issue de la fiche).
 *
 * Idempotence : la protection vit dans la persistance (`replacePreselection`
 * réconcilie par contenu et ne touche jamais les candidats décidés), pas dans
 * l'hypothèse d'un appel unique — un double-clic / retry / relance converge.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { listPreselection } from '@/lib/db/repos/vivier-preselection';
import { autoContactIfEnabled } from '@/lib/vivier/invitation-send';
import {
  PreselectionError,
  runAndPersistPreselection,
  runVivierPreselection,
} from '@/lib/vivier/preselection';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const PostSchema = z.object({
  freeText: z.string().trim().min(1).optional(),
});

function mapError(err: unknown): NextResponse {
  if (err instanceof PreselectionError) {
    // Pré-requis métier non réunis (source non cochée, fiche non validée…).
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.code === 'campaign_not_found' ? 404 : 409 },
    );
  }
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  return NextResponse.json(
    { error: 'preselection_failed', message: (err as Error).message },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;

  // Corps optionnel : un POST sans corps (activation/relance) reste valide.
  let freeText: string | undefined;
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      freeText = PostSchema.parse(JSON.parse(raw)).freeText;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Requête invalide.',
      },
      { status: 400 },
    );
  }

  try {
    if (freeText) {
      // Recherche libre : éphémère, non persistée.
      const entries = await runVivierPreselection(id, { freeText });
      return NextResponse.json({ entries, persisted: false });
    }
    const entries = await runAndPersistPreselection(id);
    // Mode contact automatique : envoi des invitations APRÈS la réponse (non
    // bloquant). No-op en mode manuel. Best-effort (ne casse pas la réponse).
    try {
      after(() => autoContactIfEnabled(id, entries));
    } catch (autoErr) {
      console.error('[vivier] planification contact auto échouée', autoErr);
    }
    return NextResponse.json({ entries, persisted: true });
  } catch (err) {
    return mapError(err);
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const entries = await listPreselection(id);
    return NextResponse.json({ entries });
  } catch (err) {
    return mapError(err);
  }
}
