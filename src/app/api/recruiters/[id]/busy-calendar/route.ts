/**
 * /api/recruiters/[id]/busy-calendar — l'agenda publié d'un recruteur.
 *
 *   GET    : état (lu il y a…, plages à venir, panne et quoi faire). Jamais l'URL.
 *   PUT    : enregistre un lien — SEULEMENT après l'avoir lu avec succès. La
 *            lecture amorce la copie : l'état est juste dès l'enregistrement.
 *   DELETE : retire le lien et oublie la copie. Toujours permis, même connecteur
 *            éteint par le cabinet : on doit pouvoir retirer ce qu'on a donné.
 *
 * Garde : soi-même ou administrateur. Déploiement sans connecteur : 404.
 * Cabinet éteint : GET répond (l'écran dit que l'agenda est ignoré), PUT 404.
 *
 * Spec : docs/specs/agenda-externe.md §8.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordBusyReadSuccess } from '@/lib/db/repos/busy-snapshots';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { patchRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { isBusyCalendarActive } from '@/lib/scheduling-host/busy/active';
import {
  DETAILS_WARNING,
  probeBusyCalendar,
  probeFailureMessage,
  probeSuccessMessage,
} from '@/lib/scheduling-host/busy/declaration';
import {
  consumeBusyCalendarQuota,
  guardBusyCalendar,
  loadBusyCalendarStatus,
  notFound,
  probeContextFor,
} from '@/lib/scheduling-host/busy/declaration-server';
import { providerLabelOf } from '@/lib/scheduling-host/busy/status';
import type { BusyCalendarSaveResponse } from '@/types/busy-calendar';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PutSchema = z.object({ url: z.string().trim().min(1).max(2048) });

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  const guarded = await guardBusyCalendar(id);
  if ('response' in guarded) return guarded.response;
  try {
    return NextResponse.json(await loadBusyCalendarStatus(id));
  } catch (err) {
    return failure(err);
  }
}

export async function PUT(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  const guarded = await guardBusyCalendar(id);
  if ('response' in guarded) return guarded.response;
  if (!(await isBusyCalendarActive())) return notFound();

  let url: string;
  try {
    url = PutSchema.parse(await request.json()).url;
  } catch {
    return NextResponse.json({ ok: false, message: 'Colle le lien de ton agenda.' }, { status: 400 });
  }

  const limited = await consumeBusyCalendarQuota(id);
  if (limited) return limited;

  try {
    const probeContext = await probeContextFor(id);
    const now = new Date();
    const probe = await probeBusyCalendar(url, { ...probeContext, now });
    if (!probe.ok) {
      const body: BusyCalendarSaveResponse = { ok: false, message: probeFailureMessage(probe.code) };
      return NextResponse.json(body, { status: 422 });
    }

    // Enregistrer oublie la copie de l'ancien agenda ; on amorce aussitôt la
    // nouvelle avec la lecture qu'on vient de faire.
    const updated = await patchRecruiter(id, { busyIcsUrl: url });
    if (!updated) return notFound();
    await recordBusyReadSuccess({
      recruiterId: id,
      intervals: probe.seed.intervals,
      windowFrom: probe.seed.windowFrom,
      windowTo: probe.seed.windowTo,
      occurrenceCount: probe.seed.occurrenceCount,
      readAt: now.toISOString(),
    });
    await appendJournalEntry({
      action: 'busy_calendar_url_set',
      actor: guarded.user.email ?? 'user',
      payload: { recruiterId: id, actorUserId: guarded.user.id, provider: providerLabelOf(probe.provider) },
    }).catch(() => undefined);

    const body: BusyCalendarSaveResponse = {
      ok: true,
      message: probeSuccessMessage(probe),
      warnings: probe.carriesDetails ? [DETAILS_WARNING] : [],
      status: await loadBusyCalendarStatus(id),
    };
    return NextResponse.json(body);
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  const guarded = await guardBusyCalendar(id);
  if ('response' in guarded) return guarded.response;
  try {
    const updated = await patchRecruiter(id, { busyIcsUrl: null });
    if (!updated) return notFound();
    await appendJournalEntry({
      action: 'busy_calendar_url_cleared',
      actor: guarded.user.email ?? 'user',
      payload: { recruiterId: id, actorUserId: guarded.user.id },
    }).catch(() => undefined);
    return NextResponse.json(await loadBusyCalendarStatus(id));
  } catch (err) {
    return failure(err);
  }
}

/** Jamais le message d'origine : il pourrait citer une valeur de la requête. */
function failure(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ ok: false, message: 'Service momentanément indisponible.' }, { status: 503 });
  }
  console.error('[busy-calendar] échec');
  return NextResponse.json({ ok: false, message: 'Une erreur est survenue. Réessaie dans un instant.' }, { status: 500 });
}
