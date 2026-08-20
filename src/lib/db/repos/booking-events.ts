/**
 * Idempotence de la consommation des événements de réservation NATIFS
 * (`interview_booking_events`). Lot 3.
 *
 * L'outbox du module livre AT-LEAST-ONCE : un dispatch en ligne qui réussit
 * son effet puis échoue à marquer la ligne sera rejoué par le drain. Le
 * consommateur doit donc être idempotent par `event.id`, exactement comme le
 * webhook l'était par `booking_uid`.
 *
 * Table DISTINCTE de `calcom_webhook_events`, délibérément : celle-là meurt à
 * la décommission (lot 5), celle-ci reste. Même politique de claim
 * (`claims-policy`) : poser AVANT l'effet, confirmer APRÈS, et distinguer un
 * rejeu prouvé d'une livraison peut-être en cours.
 */
import { resolveClaimConflict } from '@/lib/db/claims-policy';
import { requireServerSupabase } from '@/lib/db/supabase-server';

const TABLE = 'interview_booking_events';

export type BookingEventClaimVerdict = 'won' | 'in_flight' | 'already_handled';

/**
 * Réserve le traitement d'un événement.
 *   - `already_handled` : confirmé — vrai rejeu, ne rien refaire ;
 *   - `in_flight`       : claim jeune non confirmé — une autre passe traite
 *     peut-être ; l'appelant DIFFÈRE (la ligne d'outbox reste en attente) ;
 *   - `won`             : la main (insert gagné, ou reprise d'un claim périmé
 *     non confirmé — orphelin de crash).
 */
export async function claimBookingEventDelivery(
  eventId: string,
  eventType: string,
): Promise<BookingEventClaimVerdict> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      { event_id: eventId, event_type: eventType },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
    .select('event_id');
  if (error) throw new Error(`claimBookingEventDelivery: ${error.message}`);
  if ((data?.length ?? 0) > 0) return 'won';

  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select('processed_at, confirmed_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (readError) throw new Error(`claimBookingEventDelivery: ${readError.message}`);
  // Relâché par une passe concurrente entre l'insert et la lecture : on
  // diffère plutôt que de courir avec elle.
  if (!existing) return 'in_flight';

  const row = existing as { processed_at: string | null; confirmed_at: string | null };
  const verdict = resolveClaimConflict(
    { confirmedAt: row.confirmed_at, createdAt: row.processed_at },
    new Date(),
  );
  if (verdict === 'already_confirmed') return 'already_handled';
  if (verdict === 'in_flight') return 'in_flight';

  // Claim périmé non confirmé : reprise CONDITIONNELLE (un seul gagnant).
  const { data: takeover, error: takeoverError } = await supabase
    .from(TABLE)
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .is('confirmed_at', null)
    .eq('processed_at', row.processed_at as string)
    .select('event_id');
  if (takeoverError) {
    throw new Error(`claimBookingEventDelivery: ${takeoverError.message}`);
  }
  return (takeover?.length ?? 0) > 0 ? 'won' : 'in_flight';
}

/** Phase 2 : la preuve « déjà traité » que liront les rejeux du drain. */
export async function confirmBookingEventDelivery(eventId: string): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .update({ confirmed_at: new Date().toISOString() })
      .eq('event_id', eventId);
    if (error) console.error('[booking-events] confirm KO', error.message);
  } catch (err) {
    console.error('[booking-events] confirm KO', err);
  }
}

/** Relâche un claim quand le traitement échoue — le drain re-tentera. */
export async function releaseBookingEventDelivery(eventId: string): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase.from(TABLE).delete().eq('event_id', eventId);
    if (error) console.error('[booking-events] release KO', error.message);
  } catch (err) {
    console.error('[booking-events] release KO', err);
  }
}
