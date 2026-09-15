/**
 * POST /api/recruiters/[id]/busy-calendar/test — lit un lien d'agenda UNE fois
 * et dit ce qu'on y trouve (« Agenda lu : 14 plages occupées sur les 30
 * prochains jours »). Ne stocke RIEN : c'est l'enregistrement qui décide.
 *
 * Mêmes gardes que l'enregistrement : soi-même ou administrateur, connecteur
 * allumé (sinon 404), débit borné en base (chaque essai est une requête sortante).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  DETAILS_WARNING,
  probeBusyCalendar,
  probeFailureMessage,
  probeSuccessMessage,
} from '@/lib/scheduling-host/busy/declaration';
import { isBusyCalendarActive } from '@/lib/scheduling-host/busy/active';
import {
  consumeBusyCalendarQuota,
  guardBusyCalendar,
  notFound,
  probeContextFor,
} from '@/lib/scheduling-host/busy/declaration-server';
import type { BusyCalendarProbeResponse } from '@/types/busy-calendar';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({ url: z.string().trim().min(1).max(2048) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const guarded = await guardBusyCalendar(id);
  if ('response' in guarded) return guarded.response;
  if (!(await isBusyCalendarActive())) return notFound();

  let url: string;
  try {
    url = BodySchema.parse(await request.json()).url;
  } catch {
    return NextResponse.json({ ok: false, message: 'Colle le lien de ton agenda.' }, { status: 400 });
  }

  const limited = await consumeBusyCalendarQuota(id);
  if (limited) return limited;

  try {
    const probe = await probeBusyCalendar(url, { ...(await probeContextFor(id)), now: new Date() });
    const body: BusyCalendarProbeResponse = probe.ok
      ? {
          ok: true,
          message: probeSuccessMessage(probe),
          warnings: probe.carriesDetails ? [DETAILS_WARNING] : [],
          upcomingCount: probe.upcomingCount,
        }
      : { ok: false, message: probeFailureMessage(probe.code) };
    return NextResponse.json(body, { status: probe.ok ? 200 : 422 });
  } catch {
    console.error('[busy-calendar/test] échec');
    return NextResponse.json({ ok: false, message: 'Une erreur est survenue. Réessaie dans un instant.' }, { status: 500 });
  }
}
