/**
 * GET /api/cron/busy-calendars — relève périodique des agendas publiés des
 * recruteurs (connecteur agenda externe, lot C).
 *
 * Route DÉDIÉE, distincte de `/api/cron/imap-poll` : la relève IMAP partage
 * déjà ses 60 s entre quatre traitements, dont une ouverture de boîte bornée à
 * 20 s — y ajouter N lectures HTTP sortantes recréerait le défaut du 20/08
 * (invocation tuée avant toute écriture d'état). Un job cron-job.org à part,
 * à la minute, avec le même `CRON_SECRET`.
 *
 * Ce que fait une passe : lire chaque agenda configuré, mettre à jour sa copie,
 * faire avancer son état (sain → toléré → suspendu) et prévenir le recruteur —
 * MÊME SANS aucune visite de candidat. C'est le prérequis d'activation client.
 *
 * Connecteur éteint (`BUSY_CALENDAR_ENABLED`) : 200 `enabled: false`, rien
 * n'est lu — un cron qui tourne sur une installation où la fonction est
 * coupée n'est pas une erreur à remonter.
 *
 * La réponse ne porte que des compteurs.
 */
import { NextResponse } from 'next/server';

import { rejectUnauthorizedCron } from '@/lib/auth/cron-auth';
import { refreshBusyCalendars } from '@/lib/scheduling-host/busy/refresh';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const report = await refreshBusyCalendars();
  return NextResponse.json(
    { ok: !report.error, refreshedAt: new Date().toISOString(), calendars: report },
    { status: report.error ? 500 : 200 },
  );
}
