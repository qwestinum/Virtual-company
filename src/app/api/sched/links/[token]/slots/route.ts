/**
 * Créneaux offerts pour un lien de réservation. PUBLIQUE — authentifiée par le
 * jeton seul.
 *
 * Une liste vide est une réponse VALIDE : lien mort, titulaire absent, semaine
 * sans disponibilité produisent tous `[]`. On ne distingue pas ces cas ici,
 * pour ne pas transformer cette route en oracle qui dirait à un tiers si un
 * jeton existe.
 */
import { NextResponse } from 'next/server';

import { listSlotsForLink } from '@/lib/scheduling';
import { publicJson, readWindow, withPublicGuards } from '@/lib/scheduling-host/public-route';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;

  return withPublicGuards(request, { action: 'slots', token }, async () => {
    const window = readWindow(request);
    if (!window) return publicJson({ error: 'invalid_window' }, 400);

    try {
      return publicJson({ slots: await listSlotsForLink(token, window) });
    } catch {
      return publicJson({ error: 'unavailable' }, 503);
    }
  });
}
