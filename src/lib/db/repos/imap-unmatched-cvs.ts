/**
 * CV reçus par IMAP SANS campagne reconnue (table `imap_unmatched_cvs`).
 * Correctif audit C11 (trou `none`), juillet 2026.
 *
 * Avant : un mail sans identifiant `CAMP-XXXX` reconnu était skippé sans
 * trace, même avec un CV en PJ, et `last_uid_seen` avançait — corriger
 * l'association ne rejouait rien, le CV était perdu (il fallait demander un
 * renvoi). Désormais : le binaire est stocké (`unmatched/…` dans le bucket) +
 * une ligne ici + journal `imap_no_campaign_match` → REJOUABLE via
 * `POST /api/imap/unmatched/[id]/replay` une fois la campagne choisie par
 * l'humain.
 *
 * Cycle : `pending` → `replayed` (rejeu abouti, campagne mémorisée) ou
 * `dismissed` (écarté manuellement). La réservation du rejeu est
 * CONDITIONNELLE (`where status='pending'`) — un seul gagnant sous double
 * POST, conformément au pattern « réserver l'état d'abord, envoyer ensuite ».
 */
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const TABLE = 'imap_unmatched_cvs';

export type UnmatchedCvStatus = 'pending' | 'replayed' | 'dismissed';

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
  replayed_campaign_id: string | null;
  replayed_at: string | null;
  received_at: string;
};

/**
 * Enregistre un CV non rattaché (une ligne PAR pièce jointe). Idempotent sur
 * `(mailbox_id, uid, file_name)` — un re-poll concurrent ne crée pas de
 * doublon. Retourne `false` si non persisté (base absente / erreur) : la
 * TRACE journal reste l'état final, la ligne est le support du rejeu.
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
}): Promise<boolean> {
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return false;
    throw err;
  }
  const { error } = await supabase.from(TABLE).upsert(
    {
      mailbox_id: args.mailboxId,
      uid: args.uid,
      from_addr: args.fromAddr,
      subject: args.subject,
      file_name: args.fileName,
      mime: args.mime,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
    },
    { onConflict: 'mailbox_id,uid,file_name', ignoreDuplicates: true },
  );
  if (error) {
    console.error('[imap-unmatched] insert failed', error.message);
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
