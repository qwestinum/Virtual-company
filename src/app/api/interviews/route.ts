/**
 * GET /api/interviews — le poste de pilotage du cycle d'entretien : ce qui
 * attend une réservation, ce qui est programmé, ce qui attend un pointage.
 *
 * Draine la file d'événements EN ARRIÈRE-PLAN à chaque ouverture : le
 * consommateur n'est pas branché sur les surfaces candidat (le candidat ne
 * doit pas attendre), donc la personne qui vient justement regarder les
 * rendez-vous est aussi celle qu'un retard de livraison gêne. Le drain part
 * après la réponse (`after`) — il ne ralentit pas l'affichage.
 */
import { NextResponse, after } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { loadInterviewPipeline } from '@/lib/interviews/pipeline';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  // Métier : accessible à toute session (aucun cloisonnement de données).
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const url = new URL(request.url);
  try {
    const pipeline = await loadInterviewPipeline({
      campaignId: url.searchParams.get('campaignId'),
    });
    after(() => drainSchedulingEvents());
    // Identité du lecteur pour le raccourci « Mes campagnes » — rendue par la
    // ROUTE et non par la page, exactement comme la file des validations : un
    // seul chemin, quel que soit le point de montage.
    return NextResponse.json({ ...pipeline, currentUserId: user.id }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'board_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
