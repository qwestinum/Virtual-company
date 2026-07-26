/**
 * /api/notifications/business — agrégation LECTURE SEULE des signaux métier
 * (toast + badges). Comptages exhaustifs depuis les tables, requêtes légères.
 * Appelée au chargement de l'app + au changement d'onglet — pas de polling.
 *
 * Ne 500 jamais : sans persistance (démo volatile) ou sur panne d'un signal,
 * on renvoie ce qu'on a (les signaux en échec sont omis et loggés).
 */
import { NextResponse } from 'next/server';

import { computeBusinessSignals } from '@/lib/notifications/business-signals';
import type { BusinessNotificationsResponse } from '@/types/notifications';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const signals = await computeBusinessSignals();
  const body: BusinessNotificationsResponse = {
    signals,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
