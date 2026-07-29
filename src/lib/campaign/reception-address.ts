/**
 * Adresse de réception EFFECTIVE d'une campagne (server-only).
 *
 * C'est l'adresse où un candidat doit envoyer sa candidature pour qu'elle
 * soit traitée : en priorité la boîte IMAP associée à la campagne (c'est
 * elle que le poller surveille et rattache à CETTE campagne), en repli le
 * réglage global `intakeEmail` (Settings). Sans les deux, `null` — aux
 * appelants d'afficher un placeholder honnête plutôt qu'une adresse fausse.
 */

import { listEnabledMailboxEmailsForCampaign } from '@/lib/db/repos/mailboxes';

export async function resolveCampaignReceptionAddress(
  campaignId: string,
  intakeEmail: string | null | undefined,
): Promise<string | null> {
  let mailboxEmails: string[] = [];
  try {
    mailboxEmails = await listEnabledMailboxEmailsForCampaign(campaignId);
  } catch {
    // Supabase absent (démo) ou hoquet DB : on retombe sur le réglage global
    // plutôt que de faire échouer l'envoi pour une donnée d'affichage.
  }
  return mailboxEmails[0] ?? (intakeEmail?.trim() || null);
}
