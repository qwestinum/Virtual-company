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

import { resolveClaimConflict } from '@/lib/db/claims-policy';
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
    uid: row.uid ?? null,
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
  /** uid de l'analyse candidat (rattachement fiable du brief à CETTE candidature). */
  uid?: string | null;
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
    uid: input.uid ?? null,
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

/**
 * Annule les briefs OUVERTS (`awaiting_booking`/`scheduled`) d'une candidature
 * classée sans suite — bloque le « booking posthume » (un candidat classé qui
 * réserve via un lien Cal.com encore ouvert ne déclenche plus de livraison :
 * `getPendingBriefByEmail` et `listScheduledInterviewUids` excluent
 * `cancelled` par construction). Cible par uid (fiable) ET par
 * (campagne, email) en repli — les briefs historiques n'ont pas d'uid.
 * Best-effort côté appelant ; lève sur erreur DB.
 */
export async function cancelOpenBriefsForCandidate(params: {
  uid: string;
  campaignId: string | null;
  email: string | null;
}): Promise<number> {
  const supabase = requireServerSupabase();
  let cancelled = 0;
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: 'cancelled' })
    .in('status', ['awaiting_booking', 'scheduled'])
    .eq('uid', params.uid)
    .select('id');
  if (error) throw new Error(`cancelOpenBriefsForCandidate: ${error.message}`);
  cancelled += (data ?? []).length;
  if (params.campaignId && params.email) {
    const { data: byEmail, error: emailError } = await supabase
      .from(TABLE)
      .update({ status: 'cancelled' })
      .in('status', ['awaiting_booking', 'scheduled'])
      .eq('campaign_id', params.campaignId)
      .eq('candidate_email', normalizeEmail(params.email))
      .select('id');
    if (emailError)
      throw new Error(`cancelOpenBriefsForCandidate: ${emailError.message}`);
    cancelled += (byEmail ?? []).length;
  }
  return cancelled;
}

/** Réactive les briefs annulés d'une candidature rouverte : l'état d'origine
 * est reconstruit depuis `booking_uid` (présent ⇒ un RDV avait été réservé ⇒
 * `scheduled` ; absent ⇒ `awaiting_booking`). */
export async function restoreCancelledBriefsForCandidate(params: {
  uid: string;
}): Promise<number> {
  const supabase = requireServerSupabase();
  const { data: rebooked, error: rebookedError } = await supabase
    .from(TABLE)
    .update({ status: 'scheduled' })
    .eq('status', 'cancelled')
    .eq('uid', params.uid)
    .not('booking_uid', 'is', null)
    .select('id');
  if (rebookedError)
    throw new Error(`restoreCancelledBriefsForCandidate: ${rebookedError.message}`);
  const { data: awaiting, error: awaitingError } = await supabase
    .from(TABLE)
    .update({ status: 'awaiting_booking' })
    .eq('status', 'cancelled')
    .eq('uid', params.uid)
    .is('booking_uid', null)
    .select('id');
  if (awaitingError)
    throw new Error(`restoreCancelledBriefsForCandidate: ${awaitingError.message}`);
  return (rebooked ?? []).length + (awaiting ?? []).length;
}

/**
 * UID d'analyse des candidats ayant une réservation Cal.com (`scheduled`).
 * Source du tag « RDV pris » du menu Candidatures. Rattachement par UID (≠
 * email) : un même email ré-analysé / ré-testé ne fait PLUS apparaître un faux
 * « RDV pris » sur une autre candidature. Les briefs sans uid (historiques /
 * repli webhook) sont ignorés → au pire on RATE un RDV pris (statut
 * conservateur « Invité »), jamais un FAUX. Optionnellement scopé campagne.
 */
export async function listScheduledInterviewUids(
  campaignId?: string,
): Promise<Set<string>> {
  const supabase = requireServerSupabase();
  const PAGE = 1000;
  const out = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from(TABLE)
      .select('uid')
      .eq('status', 'scheduled')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (campaignId) q = q.eq('campaign_id', campaignId);
    const { data, error } = await q;
    if (error) throw new Error(`listScheduledInterviewUids: ${error.message}`);
    const rows = (data ?? []) as Array<{ uid: string | null }>;
    for (const r of rows) {
      if (r.uid) out.add(r.uid);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * RDV (réservation Cal.com) d'une candidature PRÉCISE — rattaché par UID (≠
 * email). Sert l'événement « RDV pris » de la frise. null si pas de réservation
 * fiablement rattachée à cette candidature.
 */
export async function getScheduledInterviewByUid(
  uid: string,
): Promise<{ startAt: string | null; bookedAt: string | null } | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('interview_start_at, booked_at')
    .eq('status', 'scheduled')
    .eq('uid', uid)
    .order('booked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getScheduledInterviewByUid: ${error.message}`);
  if (!data) return null;
  const row = data as { interview_start_at: string | null; booked_at: string | null };
  return { startAt: row.interview_start_at, bookedAt: row.booked_at };
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
  /** uid de l'analyse rapprochée (repli) → tag « RDV pris » fiable. */
  uid?: string | null;
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
      uid: input.uid ?? null,
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
export type BookingClaimVerdict = 'won' | 'in_flight' | 'already_delivered';

/**
 * Claim DEUX PHASES (audit I7, même durcissement que `imap_outreach_claims`) :
 * un claim posé ne prouve pas une livraison — un kill entre claim et envoi du
 * brief laissait un claim orphelin, et le retry Cal.com était absorbé en
 * `replay` ⇒ brief jamais livré. Désormais : `confirmBookingEvent` pose
 * `confirmed_at` après livraison réussie, et un conflit rend un verdict :
 *   - `already_delivered` : confirmé — vrai rejeu, ne rien refaire ;
 *   - `in_flight` : claim jeune non confirmé — livraison peut-être en cours →
 *     la route répond 500 et Cal.com re-essaiera (son mécanisme de retry) ;
 *   - `won` : la main (insert gagné ou reprise d'un claim périmé non confirmé).
 * Claims historiques (pré-migration, non confirmés) : reprenables en théorie,
 * sans effet en pratique — Cal.com ne rejoue pas des bookings anciens.
 */
export async function claimBookingEvent(
  bookingUid: string,
  triggerEvent: string,
): Promise<BookingClaimVerdict> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .upsert(
      { booking_uid: bookingUid, trigger_event: triggerEvent },
      { onConflict: 'booking_uid', ignoreDuplicates: true },
    )
    .select('booking_uid');
  if (error) throw new Error(`claimBookingEvent: ${error.message}`);
  if ((data?.length ?? 0) > 0) return 'won';

  const { data: existing, error: readError } = await supabase
    .from(EVENTS_TABLE)
    .select('processed_at, confirmed_at')
    .eq('booking_uid', bookingUid)
    .maybeSingle();
  if (readError) throw new Error(`claimBookingEvent: ${readError.message}`);
  if (!existing) return 'in_flight'; // release concurrent — Cal.com re-essaiera
  const verdict = resolveClaimConflict(
    {
      confirmedAt: (existing as { confirmed_at: string | null }).confirmed_at,
      // `processed_at` = date de pose du claim (pas de created_at dédié).
      createdAt: (existing as { processed_at: string | null }).processed_at,
    },
    new Date(),
  );
  if (verdict === 'already_confirmed') return 'already_delivered';
  if (verdict === 'in_flight') return 'in_flight';

  // Claim périmé non confirmé : reprise conditionnelle (un seul gagnant).
  const { data: takeover, error: takeoverError } = await supabase
    .from(EVENTS_TABLE)
    .update({ processed_at: new Date().toISOString() })
    .eq('booking_uid', bookingUid)
    .is('confirmed_at', null)
    .eq(
      'processed_at',
      (existing as { processed_at: string }).processed_at,
    )
    .select('booking_uid');
  if (takeoverError) {
    throw new Error(`claimBookingEvent: ${takeoverError.message}`);
  }
  return (takeover?.length ?? 0) > 0 ? 'won' : 'in_flight';
}

/**
 * CONFIRME la livraison du brief (phase 2). Best-effort : un échec laisse un
 * claim non confirmé qui expirera — rare double brief possible au retry
 * Cal.com, assumé (mieux qu'un brief jamais livré).
 */
export async function confirmBookingEvent(bookingUid: string): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(EVENTS_TABLE)
      .update({ confirmed_at: new Date().toISOString() })
      .eq('booking_uid', bookingUid);
    if (error) console.error('[calcom-claim] confirm failed', error.message);
  } catch (err) {
    console.error('[calcom-claim] confirm failed', err);
  }
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
