/**
 * /api/notifications/business — agrégation LECTURE SEULE des signaux métier
 * (toast + badges). Comptages exhaustifs depuis les tables, requêtes légères.
 * Appelée au chargement de l'app + au changement d'onglet — pas de polling.
 *
 * Ne 500 jamais : sans persistance (démo volatile) ou sur panne d'un signal,
 * on renvoie ce qu'on a (les signaux en échec sont omis et loggés).
 */
import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import { computeBusinessSignals } from '@/lib/notifications/business-signals';
import type { BusinessNotificationsResponse } from '@/types/notifications';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  // L'identité ne SÉLECTIONNE pas les dossiers — l'espace métier est commun,
  // et un candidat qui attend concerne tout le monde. Elle sert au seul signal
  // qui porte sur un réglage PERSONNEL (l'agenda) : réclamer à quelqu'un de
  // corriger la grille d'un autre ne mène à rien. Session absente ⇒ ce
  // signal-là se tait, les autres restent servis.
  const user = await getApiUser().catch(() => null);
  const signals = await computeBusinessSignals(Date.now(), {
    recruiterId: user?.id ?? null,
  });
  const body: BusinessNotificationsResponse = {
    signals,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
