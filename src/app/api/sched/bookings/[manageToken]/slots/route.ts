/**
 * Créneaux offerts pour DÉPLACER un rendez-vous existant. PUBLIQUE —
 * authentifiée par le jeton de gestion.
 */
import { NextResponse } from 'next/server';

import { listSlotOfferForManageToken } from '@/lib/scheduling';
import { publicJson, readWindow, withPublicGuards } from '@/lib/scheduling-host/public-route';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ manageToken: string }> },
): Promise<NextResponse> {
  const { manageToken } = await context.params;

  return withPublicGuards(request, { action: 'slots', token: manageToken }, async () => {
    const window = readWindow(request);
    if (!window) return publicJson({ error: 'invalid_window' }, 400);

    try {
      // `unavailable` : l'offre est SUSPENDUE (disponibilités non vérifiables),
      // ce qui n'est pas « aucun créneau » — la page le dit autrement.
      const offer = await listSlotOfferForManageToken(manageToken, window);
      return publicJson({ slots: offer.slots, unavailable: offer.unavailable });
    } catch {
      return publicJson({ error: 'unavailable' }, 503);
    }
  });
}
