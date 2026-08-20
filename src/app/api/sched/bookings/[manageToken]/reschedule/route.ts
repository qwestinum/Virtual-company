/**
 * Déplacement par l'invité. PUBLIQUE — authentifiée par le jeton de gestion.
 *
 * Le module sécurise le nouveau créneau AVANT de libérer l'ancien : si la
 * course est perdue, l'invité garde son rendez-vous initial et voit
 * `slot_taken`. Cette route ne fait que transmettre ce verdict.
 */
import { NextResponse } from 'next/server';

import { rescheduleBooking } from '@/lib/scheduling';
import { publicJson, withPublicGuards } from '@/lib/scheduling-host/public-route';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ manageToken: string }> },
): Promise<NextResponse> {
  const { manageToken } = await context.params;

  return withPublicGuards(request, { action: 'manage', token: manageToken }, async () => {
    let startAt: string | null = null;
    try {
      const body = (await request.json()) as { startAt?: unknown };
      startAt = typeof body.startAt === 'string' ? body.startAt : null;
    } catch {
      return publicJson({ error: 'invalid_body' }, 400);
    }
    if (!startAt) return publicJson({ error: 'invalid_body' }, 400);

    try {
      const result = await rescheduleBooking(manageToken, { startAt });
      if (!result.ok) {
        const opaque = ['booking_not_found', 'booking_cancelled'];
        const reason = opaque.includes(result.reason) ? 'link_gone' : result.reason;
        return publicJson({ reason }, 409);
      }
      return publicJson({
        booking: {
          startAt: result.booking.startAt,
          endAt: result.booking.endAt,
          meetingLocation: result.booking.meetingLocation,
        },
      });
    } catch {
      return publicJson({ error: 'unavailable' }, 503);
    }
  });
}
