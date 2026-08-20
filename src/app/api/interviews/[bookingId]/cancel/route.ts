/**
 * POST /api/interviews/[bookingId]/cancel — décommander un rendez-vous au nom
 * de l'organisation.
 *
 * Le candidat EST prévenu (c'est la différence avec l'annulation du classement
 * sans suite, qui a sa propre voix) : quelqu'un qui a bloqué un créneau doit
 * apprendre qu'il est libéré, et par nous.
 *
 * Le retour du briefing en « attente de réservation » n'est pas fait ici : il
 * passe par l'événement `booking.cancelled`, donc par le même chemin qu'une
 * annulation venue du candidat. Un seul code pour un seul fait.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { cancelBookingByOrganizer, getBooking } from '@/lib/scheduling';
import { parseBookingContext } from '@/lib/scheduling-host/campaign-booking';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';

export const runtime = 'nodejs';

const BodySchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  const { bookingId } = await context.params;

  let parsed: z.infer<typeof BodySchema> = {};
  try {
    parsed = BodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    parsed = {};
  }

  try {
    await ensureSchedulingConfigured();
    const booking = await getBooking(bookingId).catch(() => null);
    if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const verdict = await cancelBookingByOrganizer(bookingId, {
      reason: parsed.reason ?? null,
      notifyAttendee: true,
    });

    const ctx = parseBookingContext(booking.context);
    await appendJournalEntry({
      action: 'interview_booking_cancelled_by_organizer',
      actor: 'user',
      campaignId: ctx?.campaignId ?? null,
      payload: {
        uid: ctx?.uid ?? null,
        analysisId: ctx?.analysisId ?? null,
        bookingUid: bookingId,
        reason: parsed.reason ?? null,
        verdict,
        decidedByUserId: user.id,
      },
    }).catch(() => {});

    // La transition du briefing suit l'événement : on pousse le drain pour
    // que l'écran se remette à jour tout de suite plutôt qu'au prochain cron.
    after(() => drainSchedulingEvents());
    return NextResponse.json({ status: verdict });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'cancel_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
