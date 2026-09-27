/**
 * POST /api/validations/[id]/reserve-send — RÉSERVATION d'envoi (audit C6).
 *
 * LE verrou atomique du chemin HITL, posé côté serveur AVANT tout envoi :
 * transition conditionnelle `pending → sending` (un seul gagnant — le
 * double-clic et le second onglet reçoivent 409), avec reprise d'un `sending`
 * périmé (crash en plein envoi, TTL 5 min — jamais un piège définitif). Dès la
 * réservation, la décision est immuable (PATCH decision refusé hors
 * `pending`) : « invitation + refus au même candidat » devient impossible par
 * construction. Séquence client : réserver → mail-composer (claim d'envoi) →
 * scheduler → finaliser (/send).
 *
 * Corps OBLIGATOIRE `{ expectedDecision }` : la décision que l'écran montre
 * (27/09/2026). La base diverge ⇒ 409 `decision_changed`, rien de réservé,
 * rien d'envoyé. Un appel sans elle est refusé (400) : une réservation « à
 * l'aveugle » est exactement ce que la garde supprime.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reserveValidationSend } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { HitlDecisionSchema } from '@/types/hitl';

export const runtime = 'nodejs';

const BodySchema = z.object({ expectedDecision: HitlDecisionSchema });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        error: 'expected_decision_required',
        message:
          'La décision affichée doit accompagner la réservation — rien n’a été réservé.',
      },
      { status: 400 },
    );
  }
  try {
    const outcome = await reserveValidationSend(id, body.data.expectedDecision);
    if (typeof outcome === 'object') {
      return NextResponse.json(
        {
          error: 'decision_changed',
          current: outcome.current,
          message:
            'La décision enregistrée pour ce dossier n’est plus celle affichée — rien n’a été envoyé.',
        },
        { status: 409 },
      );
    }
    switch (outcome) {
      case 'reserved':
        return NextResponse.json({ reserved: true });
      case 'not_found':
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      case 'already_sent':
        return NextResponse.json(
          {
            error: 'already_sent',
            message: 'Cette validation a déjà été traitée et envoyée.',
          },
          { status: 409 },
        );
      case 'in_flight':
        return NextResponse.json(
          {
            error: 'send_in_flight',
            message:
              'Un envoi est déjà en cours pour cette validation — patiente quelques instants.',
          },
          { status: 409 },
        );
    }
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
