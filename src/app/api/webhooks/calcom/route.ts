/**
 * Webhook Cal.com — BOOKING_CREATED (juin 2026).
 *
 * Déclenche la délivrance du briefing d'entretien (mail au DRH + CV en PJ)
 * quand un candidat accepté réserve son créneau. Cal.com gère l'agenda du
 * recruteur de son côté (calendrier connecté) — on n'assure que le mail.
 *
 * Garde-fous :
 *   - SIGNATURE vérifiée (HMAC-SHA256, header x-cal-signature-256) — une
 *     requête non authentifiée est rejetée (sinon envoi de CV forgeable).
 *   - IDEMPOTENCE par uid de booking : un rejeu ne renvoie rien. Sur échec
 *     transitoire, le claim est relâché pour autoriser le rejeu Cal.com.
 *   - Destinataire = adresses de synthèse UNIQUEMENT (jamais le payload).
 *   - Scope = BOOKING_CREATED seul (annulation/repro gérées par Cal.com).
 */

import { NextResponse } from 'next/server';

import { parseCalcomBooking } from '@/lib/calcom/payload';
import {
  CALCOM_SIGNATURE_HEADER,
  verifyCalcomSignature,
} from '@/lib/calcom/signature';
import {
  claimBookingEvent,
  confirmBookingEvent,
  releaseBookingEvent,
} from '@/lib/db/repos/interview-briefs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { deliverBriefForBooking } from '@/lib/interview/deliver-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CAL_COM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 500 },
    );
  }

  // Corps BRUT — la signature porte sur les octets exacts (pas de JSON.parse avant).
  const rawBody = await request.text();
  const signature = request.headers.get(CALCOM_SIGNATURE_HEADER);
  if (!verifyCalcomSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const booking = parseCalcomBooking(json);
  // Forme inattendue ou trigger non géré → 200 « ignoré » (Cal.com ne rejoue pas).
  if (!booking || booking.triggerEvent !== 'BOOKING_CREATED') {
    return NextResponse.json({ status: 'ignored' });
  }

  if (!booking.attendeeEmail) {
    await appendJournalEntry({
      action: 'calcom_booking_unmatched',
      actor: 'calcom_webhook',
      payload: { reason: 'no_attendee_email', bookingUid: booking.bookingUid },
    }).catch(() => {});
    return NextResponse.json({ status: 'no_attendee_email' });
  }

  try {
    // Idempotence DEUX PHASES (audit I7) : on réserve AVANT de livrer, on
    // confirme APRÈS. Verdicts précis :
    //   - already_delivered : livraison PROUVÉE (confirmée) → vrai rejeu ;
    //   - in_flight : claim jeune non confirmé (livraison peut-être en cours,
    //     ou kill récent) → 500 : Cal.com re-essaiera, et le prochain passage
    //     verra confirmé (replay) ou périmé (reprise). Le brief n'est plus
    //     jamais perdu sur un kill entre claim et livraison.
    const claimVerdict = await claimBookingEvent(
      booking.bookingUid,
      booking.triggerEvent,
    );
    if (claimVerdict === 'already_delivered') {
      await appendJournalEntry({
        action: 'calcom_webhook_replayed',
        actor: 'calcom_webhook',
        payload: { bookingUid: booking.bookingUid, confirmed: true },
      }).catch(() => {});
      return NextResponse.json({ status: 'replay' });
    }
    if (claimVerdict === 'in_flight') {
      return NextResponse.json(
        { error: 'delivery_in_flight', retryable: true },
        { status: 500 },
      );
    }

    const result = await deliverBriefForBooking({
      bookingUid: booking.bookingUid,
      attendeeEmail: booking.attendeeEmail,
      attendeeName: booking.attendeeName,
      startTime: booking.startTime,
      endTime: booking.endTime,
      location: booking.location,
    });

    await appendJournalEntry({
      action:
        result.status === 'unmatched'
          ? 'calcom_booking_unmatched'
          : result.status === 'regenerated_delivered'
            ? 'interview_brief_regenerated'
            : 'interview_brief_delivered',
      actor: 'calcom_webhook',
      payload: {
        bookingUid: booking.bookingUid,
        attendeeEmail: booking.attendeeEmail,
        // Cf. le chemin natif : le fil d'activité nomme les gens, il ne peut
        // pas se contenter d'une adresse.
        attendeeName: booking.attendeeName,
        startAt: booking.startTime,
        status: result.status,
        providerMessageId: result.messageId ?? null,
        error: result.error,
        // Lieu RÉSOLU (lien visio si trouvé) — confirmation que le bon champ est
        // capté côté Cal.com. URL ⇒ OK ; libellé/null ⇒ videoCallUrl absent du payload.
        location: booking.location,
        // Traçabilité multi-agendas : QUEL recruteur/event-type a produit le
        // RDV (détecte un référent mal posé). Sans effet sur le matching.
        organizerEmail: booking.organizerEmail,
        organizerUsername: booking.organizerUsername,
        eventTypeId: booking.eventTypeId,
      },
    }).catch(() => {});

    // Échec TRANSITOIRE → on relâche le claim pour autoriser le rejeu Cal.com.
    if (!result.ok && result.retryable) {
      await releaseBookingEvent(booking.bookingUid).catch(() => {});
      return NextResponse.json(
        { error: 'delivery_failed', detail: result.error },
        { status: 500 },
      );
    }

    // Phase 2 : livraison aboutie (ou issue terminale non-retryable, ex.
    // unmatched) → CONFIRME le claim. C'est la preuve « déjà traité » que
    // liront les retries Cal.com futurs.
    await confirmBookingEvent(booking.bookingUid);

    return NextResponse.json({ status: result.status });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
    }
    // Erreur inattendue : relâche le claim et demande un rejeu.
    await releaseBookingEvent(booking.bookingUid).catch(() => {});
    return NextResponse.json(
      { error: 'internal_error', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
