/**
 * Confirmation d'un créneau. PUBLIQUE — authentifiée par le jeton seul.
 *
 * Les refus sont rendus tels quels au navigateur : `slot_taken` et
 * `target_changed` ne sont pas des erreurs mais des états que la page sait
 * traiter (rafraîchir la grille sans perdre la saisie). Les refus qui touchent
 * au JETON, eux, sont fondus en une seule réponse : dire « expiré » plutôt que
 * « inconnu » confirmerait à un tiers qu'un jeton a existé.
 */
import { NextResponse } from 'next/server';

import { confirmBooking, manageUrl } from '@/lib/scheduling';
import { publicJson, withPublicGuards } from '@/lib/scheduling-host/public-route';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = {
  startAt?: unknown;
  attendee?: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    timezone?: unknown;
  };
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;

  return withPublicGuards(request, { action: 'book', token }, async () => {
    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return publicJson({ error: 'invalid_body' }, 400);
    }

    const startAt = str(body.startAt);
    const name = str(body.attendee?.name);
    const email = str(body.attendee?.email);
    const timezone = str(body.attendee?.timezone);
    if (!startAt || !name || !email || !timezone) {
      return publicJson({ error: 'invalid_body' }, 400);
    }

    try {
      const result = await confirmBooking({
        token,
        startAt,
        attendee: { name, email, phone: str(body.attendee?.phone), timezone },
      });

      if (!result.ok) {
        // Tout ce qui concerne le jeton reçoit la MÊME réponse.
        const opaque = ['link_not_found', 'link_expired', 'link_gone'];
        const reason = opaque.includes(result.reason) ? 'link_gone' : result.reason;
        return publicJson({ reason }, 409);
      }

      return publicJson({
        booking: {
          startAt: result.booking.startAt,
          endAt: result.booking.endAt,
          meetingLocation: result.booking.meetingLocation,
        },
        manageUrl: manageUrl(result.manageToken),
        replay: result.replay,
      });
    } catch {
      return publicJson({ error: 'unavailable' }, 503);
    }
  });
}
