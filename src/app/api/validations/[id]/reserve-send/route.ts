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
 */
import { NextResponse } from 'next/server';

import { reserveValidationSend } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const outcome = await reserveValidationSend(id);
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
