/**
 * Repo Supabase pour les boîtes mail surveillées (Session 5 round 5).
 *
 * Le password est stocké chiffré (cf. mailbox-credentials.ts) — ce
 * repo expose des helpers pour insérer/récupérer le ciphertext sans
 * jamais le déchiffrer. La décrypte est explicite côté caller (le
 * poller et la route /test).
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';

export type MailboxRow = {
  id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  user_email: string;
  encrypted_password: string;
  is_enabled: boolean;
  last_polled_at: string | null;
  last_uid_seen: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** Vue publique sans le password chiffré (pour les API GET). */
export type MailboxPublic = Omit<MailboxRow, 'encrypted_password'>;

const TABLE = 'mailboxes';

function toPublic(row: MailboxRow): MailboxPublic {
  // Strip encrypted_password — on ne le renvoie jamais côté front.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encrypted_password, ...rest } = row;
  return rest;
}

export type CreateMailboxInput = {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSsl: boolean;
  userEmail: string;
  encryptedPassword: string;
  isEnabled?: boolean;
};

export async function listMailboxes(): Promise<MailboxPublic[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listMailboxes: ${error.message}`);
  return (data ?? []).map((r) => toPublic(r as MailboxRow));
}

export async function listEnabledMailboxesWithSecrets(): Promise<MailboxRow[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('is_enabled', true)
    .order('created_at', { ascending: true });
  if (error)
    throw new Error(`listEnabledMailboxesWithSecrets: ${error.message}`);
  return (data ?? []) as MailboxRow[];
}

export async function getMailboxWithSecrets(
  id: string,
): Promise<MailboxRow | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getMailboxWithSecrets: ${error.message}`);
  return (data as MailboxRow | null) ?? null;
}

export async function getMailbox(id: string): Promise<MailboxPublic | null> {
  const row = await getMailboxWithSecrets(id);
  return row ? toPublic(row) : null;
}

export async function insertMailbox(
  input: CreateMailboxInput,
): Promise<MailboxPublic> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: input.id,
      label: input.label,
      imap_host: input.imapHost,
      imap_port: input.imapPort,
      imap_ssl: input.imapSsl,
      user_email: input.userEmail,
      encrypted_password: input.encryptedPassword,
      is_enabled: input.isEnabled ?? true,
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertMailbox: ${error.message}`);
  return toPublic(data as MailboxRow);
}

export type UpdateMailboxPatch = {
  label?: string;
  imapHost?: string;
  imapPort?: number;
  imapSsl?: boolean;
  userEmail?: string;
  encryptedPassword?: string;
  isEnabled?: boolean;
};

export async function patchMailbox(
  id: string,
  patch: UpdateMailboxPatch,
): Promise<MailboxPublic | null> {
  const supabase = requireServerSupabase();
  const row: Partial<MailboxRow> = {};
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.imapHost !== undefined) row.imap_host = patch.imapHost;
  if (patch.imapPort !== undefined) row.imap_port = patch.imapPort;
  if (patch.imapSsl !== undefined) row.imap_ssl = patch.imapSsl;
  if (patch.userEmail !== undefined) row.user_email = patch.userEmail;
  if (patch.encryptedPassword !== undefined)
    row.encrypted_password = patch.encryptedPassword;
  if (patch.isEnabled !== undefined) row.is_enabled = patch.isEnabled;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchMailbox: ${error.message}`);
  return data ? toPublic(data as MailboxRow) : null;
}

export async function updateMailboxPollState(
  id: string,
  state: { lastUidSeen?: string; lastError?: string | null },
): Promise<void> {
  const supabase = requireServerSupabase();
  const row: Partial<MailboxRow> = {
    last_polled_at: new Date().toISOString(),
  };
  if (state.lastUidSeen !== undefined) row.last_uid_seen = state.lastUidSeen;
  if (state.lastError !== undefined) row.last_error = state.lastError;
  const { error } = await supabase.from(TABLE).update(row).eq('id', id);
  if (error) throw new Error(`updateMailboxPollState: ${error.message}`);
}

export async function deleteMailbox(id: string): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(`deleteMailbox: ${error.message}`);
}

// ─── Association campagne ↔ mailbox ─────────────────────────────────

export async function associateCampaignMailbox(
  campaignId: string,
  mailboxId: string,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase
    .from('campaign_mailboxes')
    .upsert(
      { campaign_id: campaignId, mailbox_id: mailboxId },
      { onConflict: 'campaign_id,mailbox_id' },
    );
  if (error) throw new Error(`associateCampaignMailbox: ${error.message}`);
}

export async function dissociateCampaignMailbox(
  campaignId: string,
  mailboxId: string,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('mailbox_id', mailboxId);
  if (error) throw new Error(`dissociateCampaignMailbox: ${error.message}`);
}

export async function listCampaignsForMailbox(
  mailboxId: string,
): Promise<string[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from('campaign_mailboxes')
    .select('campaign_id')
    .eq('mailbox_id', mailboxId);
  if (error) throw new Error(`listCampaignsForMailbox: ${error.message}`);
  return (data ?? []).map((r) => (r as { campaign_id: string }).campaign_id);
}

export async function listMailboxesForCampaign(
  campaignId: string,
): Promise<string[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', campaignId);
  if (error) throw new Error(`listMailboxesForCampaign: ${error.message}`);
  return (data ?? []).map((r) => (r as { mailbox_id: string }).mailbox_id);
}
