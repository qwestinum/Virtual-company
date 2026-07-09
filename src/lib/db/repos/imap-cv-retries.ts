/**
 * Compteur DURABLE des réessais d'analyse CV du poller IMAP (table
 * `imap_cv_retries`). Correctif audit C2/C3, juillet 2026.
 *
 * Pourquoi durable : sur Vercel chaque invocation cron est une instance
 * isolée — un compteur en mémoire de process ne survivrait ni entre polls ni
 * entre instances. La seule chose partagée = la base (même constat que
 * `imap_outreach_claims`).
 *
 * Sémantique FAIL-SAFE si la table manque (migration non appliquée / cache
 * PostgREST) : on retourne « état inconnu » (map vide, upsert non persisté) ⇒
 * le poller RE-TENTE SANS PLAFOND (curseur gelé). On ne consomme JAMAIS un CV
 * faute de migration — l'inverse du fail-open des claims (où un doublon vaut
 * mieux qu'un candidat muet ; ici un réessai de trop vaut mieux qu'un CV
 * perdu ou abandonné à tort).
 */
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const TABLE = 'imap_cv_retries';

export type CvRetryState = {
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

type CvRetryRow = {
  uid: string;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
};

/**
 * Charge tous les réessais en cours d'une boîte (une requête par poll, pas
 * une par message — les lignes n'existent que pour les échecs, donc rares).
 * Fail-safe : map vide sur base absente/erreur (⇒ pas de plafond).
 */
export async function listCvRetryStates(
  mailboxId: string,
): Promise<Map<string, CvRetryState>> {
  const states = new Map<string, CvRetryState>();
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return states;
    throw err;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select('uid, attempts, next_retry_at, last_error')
    .eq('mailbox_id', mailboxId);
  if (error) {
    console.error('[imap-cv-retries] list failed (fail-safe)', error.message);
    return states;
  }
  for (const row of (data ?? []) as CvRetryRow[]) {
    states.set(row.uid, {
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at,
      lastError: row.last_error,
    });
  }
  return states;
}

/**
 * Enregistre un échec re-tentable : pose `attempts` + `next_retry_at` calculés
 * par l'appelant (lecture faite depuis la map du poll — un léger sous-comptage
 * sous crons concurrents est acceptable, il va dans le sens du réessai).
 * Retourne `false` si non persisté (fail-safe ⇒ pas de plafond côté appelant).
 */
export async function upsertCvRetryState(args: {
  mailboxId: string;
  uid: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string;
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
      attempts: args.attempts,
      next_retry_at: args.nextRetryAt,
      // Tronqué : trace de diagnostic, pas un dump.
      last_error: args.lastError.slice(0, 500),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox_id,uid' },
  );
  if (error) {
    console.error('[imap-cv-retries] upsert failed (fail-safe)', error.message);
    return false;
  }
  return true;
}

/**
 * Purge l'état de réessai (analyse aboutie, ou abandon acté). Best-effort :
 * ne casse jamais le flux appelant.
 */
export async function clearCvRetryState(
  mailboxId: string,
  uid: string,
): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('mailbox_id', mailboxId)
      .eq('uid', uid);
    if (error) {
      console.error('[imap-cv-retries] clear failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-cv-retries] clear failed', err);
    }
  }
}
