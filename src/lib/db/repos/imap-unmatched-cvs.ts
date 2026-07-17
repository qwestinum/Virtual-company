/**
 * CV reçus par IMAP mais NON TRAITÉS, rejouables (table `imap_unmatched_cvs`).
 * Correctifs audit C11 (trou `none`) + C4 (fiche non validée), juillet 2026.
 *
 * Deux origines, distinguées par `reason` :
 *   - `none` (C11) : aucune campagne reconnue (pas de `CAMP-XXXX` dans le
 *     sujet ni le corps) — `campaign_id` inconnu, l'HUMAIN choisit la campagne
 *     au rejeu (`POST /api/imap/unmatched/[id]/replay`).
 *   - `pending_sheet` (C4) : campagne CONNUE (`campaign_id` renseigné) mais
 *     fiche de scoring pas encore validée à la réception — avant, le binaire
 *     n'était jamais stocké et la première vague d'une campagne était perdue.
 *     Drain AUTOMATIQUE à la validation de la fiche (hook PUT/PATCH campagnes,
 *     `drainPendingSheetCvs`).
 *
 * Dans les deux cas : binaire stocké (`unmatched/…` dans le bucket) + une
 * ligne ici + trace journal.
 *
 * Cycle : `pending` → `replayed` (rejeu abouti, campagne mémorisée) ou
 * `dismissed` (écarté manuellement). La réservation du rejeu est
 * CONDITIONNELLE (`where status='pending'`) — un seul gagnant sous double
 * POST, conformément au pattern « réserver l'état d'abord, envoyer ensuite ».
 */
import { fetchAllKeyset } from '@/lib/db/paginate';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const TABLE = 'imap_unmatched_cvs';

export type UnmatchedCvStatus = 'pending' | 'replayed' | 'dismissed';

export type UnmatchedCvReason = 'none' | 'pending_sheet';

export type UnmatchedCvRow = {
  id: string;
  mailbox_id: string;
  uid: string;
  from_addr: string | null;
  subject: string | null;
  file_name: string;
  mime: string;
  storage_bucket: string | null;
  storage_path: string | null;
  status: UnmatchedCvStatus;
  /** Campagne d'origine — connue pour un `pending_sheet`, null pour un `none`. */
  campaign_id: string | null;
  reason: UnmatchedCvReason;
  replayed_campaign_id: string | null;
  replayed_at: string | null;
  received_at: string;
};

/**
 * Enregistre un CV non traité (une ligne PAR pièce jointe). Idempotent sur
 * `(mailbox_id, uid, file_name)` — un re-poll concurrent ne crée pas de
 * doublon. Retourne `false` si non persisté (base absente / erreur) : la
 * TRACE journal reste l'état final, la ligne est le support du rejeu.
 *
 * Repli legacy : si la migration C4 (`campaign_id`/`reason`) n'est pas encore
 * appliquée (colonne absente du cache PostgREST), on ré-essaie SANS ces
 * colonnes — la ligne existe alors en `reason='none'` (défaut base), toujours
 * rejouable par un humain qui choisit la campagne. Dégradation bruyante,
 * jamais silencieuse.
 */
export async function insertUnmatchedCv(args: {
  mailboxId: string;
  uid: string;
  fromAddr: string | null;
  subject: string | null;
  fileName: string;
  mime: string;
  storageBucket: string | null;
  storagePath: string | null;
  campaignId?: string | null;
  reason?: UnmatchedCvReason;
}): Promise<boolean> {
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return false;
    throw err;
  }
  const legacyPayload = {
    mailbox_id: args.mailboxId,
    uid: args.uid,
    from_addr: args.fromAddr,
    subject: args.subject,
    file_name: args.fileName,
    mime: args.mime,
    storage_bucket: args.storageBucket,
    storage_path: args.storagePath,
  };
  const upsertOpts = {
    onConflict: 'mailbox_id,uid,file_name',
    ignoreDuplicates: true,
  } as const;
  const { error } = await supabase.from(TABLE).upsert(
    {
      ...legacyPayload,
      campaign_id: args.campaignId ?? null,
      reason: args.reason ?? 'none',
    },
    upsertOpts,
  );
  if (!error) return true;
  console.error(
    '[imap-unmatched] insert failed — retry legacy sans campaign_id/reason (migration C4 appliquée ?)',
    error.message,
  );
  const { error: legacyError } = await supabase
    .from(TABLE)
    .upsert(legacyPayload, upsertOpts);
  if (legacyError) {
    console.error('[imap-unmatched] insert legacy failed', legacyError.message);
    return false;
  }
  return true;
}

/** Liste par statut (défaut : les `pending`, à rejouer/écarter). */
export async function listUnmatchedCvs(
  status: UnmatchedCvStatus = 'pending',
): Promise<UnmatchedCvRow[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', status)
    .order('received_at', { ascending: false });
  if (error) throw new Error(`listUnmatchedCvs: ${error.message}`);
  return (data ?? []) as UnmatchedCvRow[];
}

/**
 * Les CV « en attente de fiche » (C4) d'une campagne, EXHAUSTIF (keyset sur la
 * PK — jamais de cap PostgREST silencieux). C'est la file que draine
 * `drainPendingSheetCvs` à la validation de la fiche de scoring.
 */
export async function listPendingSheetCvs(
  campaignId: string,
): Promise<UnmatchedCvRow[]> {
  const supabase = requireServerSupabase();
  return fetchAllKeyset<UnmatchedCvRow>({
    fetchPage: async (afterId, limit) => {
      let q = supabase
        .from(TABLE)
        .select('*')
        .eq('status', 'pending')
        .eq('reason', 'pending_sheet')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .limit(limit);
      if (afterId !== null) q = q.gt('id', afterId);
      const { data, error } = await q;
      if (error) throw new Error(`listPendingSheetCvs: ${error.message}`);
      return (data ?? []) as UnmatchedCvRow[];
    },
    cursorOf: (row) => row.id,
  });
}

export async function getUnmatchedCv(
  id: string,
): Promise<UnmatchedCvRow | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getUnmatchedCv: ${error.message}`);
  return (data as UnmatchedCvRow | null) ?? null;
}

/** Compteur pour le diagnostic (`GET /api/imap/status`). Best-effort : 0 si base absente. */
export async function countUnmatchedPending(): Promise<number> {
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return 0;
    throw err;
  }
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) {
    console.error('[imap-unmatched] count failed', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * RÉSERVE le rejeu (transition conditionnelle `pending → replayed`) AVANT
 * tout effet de bord : sous double POST concurrent, un seul gagnant — l'autre
 * reçoit `false` (409 côté route). Le pattern validé pour les chemins humains.
 */
export async function reserveUnmatchedReplay(
  id: string,
  campaignId: string,
): Promise<boolean> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'replayed',
      replayed_campaign_id: campaignId,
      replayed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`reserveUnmatchedReplay: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Rend le CV re-rejouable après un rejeu ÉCHOUÉ (best-effort — les claims
 * d'idempotence `(mailbox, uid, mode)` garantissent qu'un re-rejeu ne renvoie
 * jamais un mail déjà parti).
 */
export async function revertUnmatchedReplay(id: string): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .update({ status: 'pending', replayed_campaign_id: null, replayed_at: null })
      .eq('id', id)
      .eq('status', 'replayed');
    if (error) console.error('[imap-unmatched] revert failed', error.message);
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-unmatched] revert failed', err);
    }
  }
}
