/**
 * Idempotence de l'outreach IMAP (table `imap_outreach_claims`). Juin 2026.
 *
 * Problème : sur Vercel, chaque hit du cron `/api/cron/imap-poll` est une
 * INSTANCE isolée. La garde anti-réentrance du poller (`__imapPollInFlight__`,
 * en mémoire de process) ne sérialise donc PAS deux invocations concurrentes :
 * elles lisent le même `last_uid_seen`, retraitent le même message et
 * envoyaient le mail candidat DEUX fois. La seule chose partagée entre deux
 * instances Vercel = la base. On y pose un verrou durable.
 *
 * `claimOutreach` réserve (mailbox, uid, mode) en `INSERT … ON CONFLICT DO
 * NOTHING` : `true` = CE process a gagné la réservation (il envoie), `false` =
 * déjà réservée (la passe concurrente n'envoie rien). `releaseOutreachClaim`
 * retire la clé quand l'envoi n'aboutit PAS, pour qu'un re-poll puisse
 * renvoyer (anti-perte silencieuse : jamais un candidat muet à cause d'un
 * claim orphelin). Même pattern que l'idempotence webhook Cal.com
 * (`claimBookingEvent` / `releaseBookingEvent`).
 */
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const TABLE = 'imap_outreach_claims';

export type OutreachClaimKey = {
  mailboxId: string;
  uid: string;
  mode: 'invite' | 'reject';
};

/**
 * Réserve l'envoi outreach pour (mailbox, uid, mode). Retourne `true` si CE
 * process a posé la clé (il doit envoyer), `false` si une autre passe l'a déjà
 * réservée (ne pas envoyer, sinon doublon).
 *
 * Deux cas de repli en `true` (fail-open) : base non configurée (démo locale
 * mono-process, aucune concurrence) et erreur DB transitoire. Le choix est
 * délibéré — mieux un rare doublon qu'un candidat muet (cf. sensibilité
 * « perte silencieuse » du projet).
 */
export async function claimOutreach(key: OutreachClaimKey): Promise<boolean> {
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return true;
    throw err;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      { mailbox_id: key.mailboxId, uid: key.uid, mode: key.mode },
      { onConflict: 'mailbox_id,uid,mode', ignoreDuplicates: true },
    )
    .select('mailbox_id');
  if (error) {
    console.error('[outreach-claim] claim failed (fail-open)', error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Relâche un claim — appelé quand l'envoi n'aboutit PAS (échec/skip), pour
 * qu'un re-poll puisse renvoyer. Best-effort : ne casse jamais le flux
 * appelant (avale Supabase non configuré, logue le reste).
 */
export async function releaseOutreachClaim(
  key: OutreachClaimKey,
): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('mailbox_id', key.mailboxId)
      .eq('uid', key.uid)
      .eq('mode', key.mode);
    if (error) {
      console.error('[outreach-claim] release failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[outreach-claim] release failed', err);
    }
  }
}
