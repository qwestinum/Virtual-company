/**
 * GET /api/settings/agenda-status — ce que le lien d'agenda des Paramètres
 * porte RÉELLEMENT, campagne active par campagne active (27/09/2026).
 *
 * Chaque campagne passe par la même sonde que l'envoi d'une invitation
 * (`campaignAgendaState`) : l'écran ne peut pas dire « bloqué » quand l'envoi
 * passerait, ni l'inverse. Lecture seule, sans effet (aucun jeton émis).
 * Échec ⇒ 503 : l'écran retombe sur la règle générale, jamais sur un faux
 * « tout va bien ».
 */
import { NextResponse } from 'next/server';

import {
  campaignAgendaState,
  hasEnvAgendaFallback,
} from '@/lib/agents/server/interview-mail';
import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { mapWithConcurrency } from '@/lib/async/concurrency';
import { listActiveCampaignBriefs } from '@/lib/db/repos/campaigns';
import { summarizeAgendaStatus } from '@/lib/interview/agenda-status';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  if (!(await getApiUser())) return unauthorizedResponse();
  try {
    const campaigns = await listActiveCampaignBriefs();
    const states = await mapWithConcurrency(campaigns, 5, (c) => campaignAgendaState(c.id));
    return NextResponse.json({
      status: summarizeAgendaStatus(states, hasEnvAgendaFallback()),
    });
  } catch (err) {
    console.error('[settings/agenda-status]', err);
    return NextResponse.json({ error: 'agenda_status_unavailable' }, { status: 503 });
  }
}
