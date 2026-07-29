/**
 * Idempotence de l'outreach (table `imap_outreach_claims`). Juin 2026,
 * durci en claims DEUX PHASES en juillet 2026 (audit C5/C6).
 *
 * Problème d'origine : sur Vercel, chaque hit du cron `/api/cron/imap-poll`
 * est une INSTANCE isolée. La garde anti-réentrance du poller
 * (`__imapPollInFlight__`, en mémoire de process) ne sérialise donc PAS deux
 * invocations concurrentes : elles lisent le même `last_uid_seen`, retraitent
 * le même message et envoyaient le mail candidat DEUX fois. La seule chose
 * partagée entre deux instances Vercel = la base. On y pose un verrou durable.
 *
 * Durcissement C5 (claims deux phases) : un claim posé ne prouvait PAS un
 * mail parti — un crash entre claim et `sendEmail` laissait un claim ORPHELIN
 * et le re-poll (quelques secondes plus tard) concluait « duplicate » à tort ⇒
 * candidat muet À JAMAIS. Désormais le claim est CONFIRMÉ (`confirmed_at`)
 * après l'envoi réussi, et le perdant d'un conflit reçoit un verdict précis :
 *   - `already_sent` : claim CONFIRMÉ — l'envoi a eu lieu, prouvé. Final.
 *   - `in_flight`    : claim jeune non confirmé — une autre passe envoie
 *                      peut-être en ce moment. DIFFÉRER (pas final).
 *   - `won`          : ce process a la main (insert gagné, ou REPRISE d'un
 *                      claim périmé non confirmé — orphelin de crash).
 * Fenêtre résiduelle assumée : crash entre l'envoi réussi et `confirmed_at`
 * ⇒ reprise après TTL = rare doublon (documenté, trade-off « mieux un rare
 * doublon qu'un candidat muet »).
 *
 * Le scope du claim est générique : chemin auto IMAP (`mailbox_id` = id de
 * boîte, `uid` = uid mail) ET chemin de validation HUMAINE
 * (`mailbox_id = 'hitl_validation'`, `uid` = id de validation) — audit C6,
 * même mécanisme, aucun chemin parallèle.
 *
 * `releaseOutreachClaim` retire la clé quand l'envoi n'aboutit PAS (échec
 * propre OU exception — appelé dans le catch de l'appelant), pour qu'un
 * réessai puisse renvoyer. Même pattern que l'idempotence webhook Cal.com.
 */
import {
  resolveClaimConflict,
  type ClaimConflictVerdict,
} from '@/lib/db/claims-policy';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const TABLE = 'imap_outreach_claims';

export type OutreachClaimKey = {
  mailboxId: string;
  uid: string;
  /** `dismiss` = mail d'information « classée sans suite » (pseudo-mailbox
   * `candidature_dismissal`) — même table, même mécanique, aucun rail parallèle. */
  mode: 'invite' | 'reject' | 'dismiss';
};

export type OutreachClaimVerdict = 'won' | 'in_flight' | 'already_sent';

/**
 * Réserve l'envoi pour (mailbox, uid, mode) — verdict deux-phases (cf. header).
 *
 * Deux cas de repli en `won` (fail-open) : base non configurée (démo locale
 * mono-process, aucune concurrence) et erreur DB transitoire. Le choix est
 * délibéré — mieux un rare doublon qu'un candidat muet (cf. sensibilité
 * « perte silencieuse » du projet).
 */
export async function claimOutreach(
  key: OutreachClaimKey,
): Promise<OutreachClaimVerdict> {
  let supabase;
  try {
    supabase = requireServerSupabase();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return 'won';
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
    return 'won';
  }
  if ((data?.length ?? 0) > 0) return 'won';

  // Conflit : un claim existe déjà. Verdict selon son état réel.
  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select('created_at, confirmed_at')
    .eq('mailbox_id', key.mailboxId)
    .eq('uid', key.uid)
    .eq('mode', key.mode)
    .maybeSingle();
  if (readError || !existing) {
    // Claim disparu entre-temps (release concurrent) ou illisible : différer —
    // le prochain passage retentera proprement.
    if (readError) {
      console.error('[outreach-claim] read failed', readError.message);
    }
    return 'in_flight';
  }
  const verdict: ClaimConflictVerdict = resolveClaimConflict(
    {
      confirmedAt: (existing as { confirmed_at: string | null }).confirmed_at,
      createdAt: (existing as { created_at: string | null }).created_at,
    },
    new Date(),
  );
  if (verdict === 'already_confirmed') return 'already_sent';
  if (verdict === 'in_flight') return 'in_flight';

  // Claim PÉRIMÉ non confirmé = orphelin de crash. REPRISE conditionnelle
  // (un seul gagnant : le `where confirmed_at is null and created_at = <lu>`
  // perd si une autre passe a repris/confirmé entre-temps).
  const { data: takeover, error: takeoverError } = await supabase
    .from(TABLE)
    .update({ created_at: new Date().toISOString() })
    .eq('mailbox_id', key.mailboxId)
    .eq('uid', key.uid)
    .eq('mode', key.mode)
    .is('confirmed_at', null)
    .eq('created_at', (existing as { created_at: string }).created_at)
    .select('mailbox_id');
  if (takeoverError) {
    console.error('[outreach-claim] takeover failed', takeoverError.message);
    return 'in_flight';
  }
  return (takeover?.length ?? 0) > 0 ? 'won' : 'in_flight';
}

/**
 * CONFIRME le claim après un envoi RÉUSSI — c'est la preuve « déjà envoyé »
 * que liront les passes concurrentes. Best-effort : un échec ici laisse un
 * claim non confirmé qui expirera (rare doublon possible, assumé) — on ne
 * casse jamais le flux post-envoi pour ça.
 */
export async function confirmOutreachClaim(
  key: OutreachClaimKey,
): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .update({ confirmed_at: new Date().toISOString() })
      .eq('mailbox_id', key.mailboxId)
      .eq('uid', key.uid)
      .eq('mode', key.mode);
    if (error) {
      console.error('[outreach-claim] confirm failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[outreach-claim] confirm failed', err);
    }
  }
}

/**
 * Relâche un claim — appelé quand l'envoi n'aboutit PAS (échec propre OU
 * exception, via le catch de l'appelant), pour qu'un réessai puisse renvoyer.
 * Best-effort : ne casse jamais le flux appelant (avale Supabase non
 * configuré, logue le reste). Ne touche JAMAIS un claim confirmé.
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
      .eq('mode', key.mode)
      .is('confirmed_at', null);
    if (error) {
      console.error('[outreach-claim] release failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[outreach-claim] release failed', err);
    }
  }
}
