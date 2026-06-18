/**
 * Repo Supabase — briefings d'entretien (`interview_briefs`) + idempotence
 * webhook Cal.com (`calcom_webhook_events`). Juin 2026.
 *
 * Voir docs : la réservation Cal.com (BOOKING_CREATED) pilote la délivrance.
 * Un briefing est d'abord MIS EN FILE (`awaiting_booking`) à l'acceptation du
 * CV, puis DÉLIVRÉ (`scheduled`) à la réservation. Cette table porte aussi
 * l'état des candidatures retenues pour le dashboard.
 *
 * Idempotence : `claimBookingEvent` insère la clé du booking en `ON CONFLICT
 * DO NOTHING` — retourne `true` au premier passage, `false` sur un rejeu.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { InterviewBriefRow } from '@/lib/db/types';
import { normalizeEmail } from '@/lib/vivier/candidates';
import type {
  InterviewBrief,
  InterviewQuestion,
} from '@/types/interview-brief';
import type { MailCandidate } from '@/types/mail-candidate';

const TABLE = 'interview_briefs';
const EVENTS_TABLE = 'calcom_webhook_events';

/** Mapping row → domaine (pur, exporté pour test). */
export function interviewBriefRowToDomain(row: InterviewBriefRow): InterviewBrief {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    taskId: row.task_id,
    candidateEmail: row.candidate_email,
    candidateName: row.candidate_name,
    jobTitle: row.job_title,
    status: row.status,
    questions: Array.isArray(row.questions) ? row.questions : [],
    candidate: row.candidate_snapshot,
    bookingUid: row.booking_uid,
    interviewStartAt: row.interview_start_at,
    interviewEndAt: row.interview_end_at,
    interviewLocation: row.interview_location,
    deliveredMessageId: row.delivered_message_id,
    createdAt: row.created_at,
    bookedAt: row.booked_at,
    updatedAt: row.updated_at,
  };
}

/** Découpe l'identifiant propriétaire (campagne vs tâche isolée). */
function ownerColumns(ownerId: string): {
  campaign_id: string | null;
  task_id: string | null;
} {
  return ownerId.startsWith('TASK-')
    ? { campaign_id: null, task_id: ownerId }
    : { campaign_id: ownerId, task_id: null };
}

export type QueueBriefInput = {
  /** CAMP-XXXX ou TASK-XXXX. */
  ownerId: string;
  jobTitle: string | null;
  candidate: MailCandidate;
  questions: InterviewQuestion[];
};

/**
 * Met en file (ou rafraîchit) un briefing `awaiting_booking`. Idempotent par
 * (propriétaire, email) : ré-accepter le même candidat sur la même campagne
 * met à jour la trame existante au lieu d'empiler des doublons. Sans email,
 * insère systématiquement (pas de clé de dédup possible).
 */
export async function queuePendingBrief(
  input: QueueBriefInput,
): Promise<InterviewBrief> {
  const supabase = requireServerSupabase();
  const owner = ownerColumns(input.ownerId);
  const email = input.candidate.email
    ? normalizeEmail(input.candidate.email)
    : null;

  const payload = {
    ...owner,
    candidate_email: email,
    candidate_name: input.candidate.candidateName,
    job_title: input.jobTitle,
    status: 'awaiting_booking' as const,
    questions: input.questions,
    candidate_snapshot: input.candidate,
  };

  if (email) {
    // Cherche un briefing en attente existant pour (propriétaire, email).
    let q = supabase
      .from(TABLE)
      .select('id')
      .eq('status', 'awaiting_booking')
      .eq('candidate_email', email)
      .limit(1);
    q = owner.task_id
      ? q.eq('task_id', owner.task_id)
      : q.eq('campaign_id', owner.campaign_id as string);
    const { data: existing, error: findErr } = await q.maybeSingle();
    if (findErr) throw new Error(`queuePendingBrief (find): ${findErr.message}`);
    if (existing) {
      const { data, error } = await supabase
        .from(TABLE)
        .update(payload)
        .eq('id', (existing as { id: string }).id)
        .select('*')
        .single();
      if (error) throw new Error(`queuePendingBrief (update): ${error.message}`);
      return interviewBriefRowToDomain(data as InterviewBriefRow);
    }
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select('*')
    .single();
  if (error) throw new Error(`queuePendingBrief (insert): ${error.message}`);
  return interviewBriefRowToDomain(data as InterviewBriefRow);
}

/**
 * Briefing EN ATTENTE le plus récent pour un email (clé de matching webhook).
 * `null` si aucun — le webhook bascule alors sur la régénération à la volée.
 */
export async function getPendingBriefByEmail(
  email: string,
): Promise<InterviewBrief | null> {
  const supabase = requireServerSupabase();
  const normalized = normalizeEmail(email);
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', 'awaiting_booking')
    .eq('candidate_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getPendingBriefByEmail: ${error.message}`);
  return data ? interviewBriefRowToDomain(data as InterviewBriefRow) : null;
}

export type BookingDelivery = {
  bookingUid: string;
  interviewStartAt: string | null;
  interviewEndAt: string | null;
  interviewLocation: string | null;
  deliveredMessageId: string | null;
};

/** Bascule un briefing existant en `scheduled` (réservation reçue + livré). */
export async function markBriefScheduled(
  id: string,
  delivery: BookingDelivery,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase
    .from(TABLE)
    .update({
      status: 'scheduled',
      booking_uid: delivery.bookingUid,
      interview_start_at: delivery.interviewStartAt,
      interview_end_at: delivery.interviewEndAt,
      interview_location: delivery.interviewLocation,
      delivered_message_id: delivery.deliveredMessageId,
      booked_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`markBriefScheduled: ${error.message}`);
}

/**
 * Crée directement un briefing `scheduled` — chemin REPLI : la réservation
 * arrive sans briefing préexistant (candidat ancien, file purgée), on a
 * régénéré la trame à la volée et livré dans la foulée.
 */
export async function createScheduledBrief(input: {
  ownerId: string | null;
  jobTitle: string | null;
  candidate: MailCandidate;
  questions: InterviewQuestion[];
  delivery: BookingDelivery;
}): Promise<InterviewBrief> {
  const supabase = requireServerSupabase();
  const owner = input.ownerId
    ? ownerColumns(input.ownerId)
    : { campaign_id: null, task_id: null };
  const email = input.candidate.email
    ? normalizeEmail(input.candidate.email)
    : null;
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...owner,
      candidate_email: email,
      candidate_name: input.candidate.candidateName,
      job_title: input.jobTitle,
      status: 'scheduled',
      questions: input.questions,
      candidate_snapshot: input.candidate,
      booking_uid: input.delivery.bookingUid,
      interview_start_at: input.delivery.interviewStartAt,
      interview_end_at: input.delivery.interviewEndAt,
      interview_location: input.delivery.interviewLocation,
      delivered_message_id: input.delivery.deliveredMessageId,
      booked_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw new Error(`createScheduledBrief: ${error.message}`);
  return interviewBriefRowToDomain(data as InterviewBriefRow);
}

// ─── Idempotence webhook Cal.com ──────────────────────────────────────

/**
 * Réserve le traitement d'un booking. `INSERT … ON CONFLICT DO NOTHING` via
 * upsert `ignoreDuplicates` : retourne `true` au PREMIER passage (clé posée),
 * `false` sur un rejeu (clé déjà présente). Le webhook ne délivre que si
 * `true` — garantit qu'un même booking ne déclenche qu'un seul envoi.
 */
export async function claimBookingEvent(
  bookingUid: string,
  triggerEvent: string,
): Promise<boolean> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .upsert(
      { booking_uid: bookingUid, trigger_event: triggerEvent },
      { onConflict: 'booking_uid', ignoreDuplicates: true },
    )
    .select('booking_uid');
  if (error) throw new Error(`claimBookingEvent: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Relâche un claim — appelé quand la délivrance échoue de façon TRANSITOIRE,
 * pour qu'un rejeu Cal.com puisse re-tenter. Idempotent.
 */
export async function releaseBookingEvent(bookingUid: string): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase
    .from(EVENTS_TABLE)
    .delete()
    .eq('booking_uid', bookingUid);
  if (error) throw new Error(`releaseBookingEvent: ${error.message}`);
}
