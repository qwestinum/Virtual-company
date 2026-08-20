/**
 * Annulation par l'invité. PUBLIQUE — authentifiée par le jeton de gestion.
 *
 * `already_cancelled` répond 409 mais la page le traite comme un succès : si
 * quelqu'un annule deux fois (double-clic, retour arrière), le résultat voulu
 * est atteint, et lui afficher une erreur serait mentir sur l'état réel.
 */
import { NextResponse } from 'next/server';

import { cancelBookingByAttendee } from '@/lib/scheduling';
import { publicJson, withPublicGuards } from '@/lib/scheduling-host/public-route';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ manageToken: string }> },
): Promise<NextResponse> {
  const { manageToken } = await context.params;

  return withPublicGuards(request, { action: 'manage', token: manageToken }, async () => {
    try {
      const verdict = await cancelBookingByAttendee(manageToken, {});
      if (verdict === 'cancelled') return publicJson({ status: 'cancelled' });
      if (verdict === 'already_cancelled') {
        return publicJson({ status: 'already_cancelled' }, 409);
      }
      return publicJson({ error: 'not_found' }, 404);
    } catch {
      return publicJson({ error: 'unavailable' }, 503);
    }
  });
}
