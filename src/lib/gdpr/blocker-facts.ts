/**
 * Collecte des faits qui ARRÊTENT un effacement.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.5.
 *
 * La mise en forme des messages vit dans `blockers.ts` (pure, testable). Ici on
 * ne fait que lire l'état — la séparation compte : c'est le message qui est
 * destiné au responsable de traitement, et il doit pouvoir être relu et corrigé
 * sans toucher à une requête.
 *
 * Un entretien « programmé » SANS date enregistrée bloque aussi. On ne peut pas
 * écarter l'hypothèse d'un engagement à venir, et le message le dit tel quel
 * plutôt que d'inventer une date ou de passer outre en silence.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { pageAllByText } from '@/lib/gdpr/scan';
import type { BlockerFacts } from '@/lib/gdpr/blockers';
import type { ErasureIdentity } from '@/types/gdpr';

export async function collectBlockerFacts(
  db: SupabaseClient,
  identity: ErasureIdentity,
  now: Date = new Date(),
): Promise<BlockerFacts> {
  const nowIso = now.toISOString();

  const briefs = await byIds<{
    id: string;
    status: string;
    interview_start_at: string | null;
    campaign_id: string | null;
    task_id: string | null;
  }>(
    db,
    'interview_briefs',
    'id, status, interview_start_at, campaign_id, task_id',
    identity.briefIds,
  );
  const scheduledInterviews = briefs
    .filter(
      (b) =>
        b.status === 'scheduled' &&
        (b.interview_start_at === null || b.interview_start_at > nowIso),
    )
    .map((b) => ({
      ref: `interview_briefs#${b.id}`,
      startAt: b.interview_start_at,
      campaignId: b.campaign_id ?? b.task_id,
    }));

  const bookings = await byIds<{
    id: string;
    status: string;
    start_at: string;
    context: Record<string, unknown> | null;
  }>(db, 'sched_bookings', 'id, status, start_at, context', identity.bookingIds);
  const confirmedBookings = bookings
    .filter((b) => b.status === 'confirmed' && b.start_at > nowIso)
    .map((b) => ({
      ref: `sched_bookings#${b.id}`,
      startAt: b.start_at,
      campaignId:
        typeof b.context?.campaignId === 'string' ? b.context.campaignId : null,
    }));

  const validations = await byIds<{ id: string; status: string; sending_at: string | null }>(
    db,
    'pending_validations',
    'id, status, sending_at',
    identity.validationIds,
  );
  const sendingValidations = validations
    .filter((v) => v.status === 'sending')
    .map((v) => ({ ref: `pending_validations#${v.id}`, since: v.sending_at }));

  return { scheduledInterviews, confirmedBookings, sendingValidations };
}

async function byIds<Row extends Record<string, unknown>>(
  db: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
): Promise<Row[]> {
  if (ids.length === 0) return [];
  return pageAllByText<Row>(db, table, columns, 'id', [
    { op: 'in', col: 'id', values: ids },
  ]);
}
