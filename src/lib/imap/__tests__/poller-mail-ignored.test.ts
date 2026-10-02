/**
 * « Aucun mail vu ne disparaît sans un mot » — par une VRAIE relève.
 *
 * Incident S2I du 01/10/2026 : un mail de test sans trace, et un second dont
 * la trace affirmait « aucun identifiant CAMP-XXXX » alors qu'il était dans
 * l'objet. Ici la relève tourne pour de bon (`pollMailbox`), sur une boîte
 * IMAP simulée qui rend de vrais messages MIME ; seuls la base, le stockage
 * et le serveur sont remplacés.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crypto/mailbox-credentials', () => ({ decryptCredential: () => 'mot-de-passe' }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn() }));
vi.mock('@/lib/db/repos/mailboxes', () => ({
  listCampaignLinksForMailbox: vi.fn(),
  updateMailboxPollState: vi.fn(),
  listEnabledMailboxesForPoll: vi.fn(),
  mailboxFolder: (m: { folder?: string | null }) => m.folder?.trim() || 'INBOX',
}));
vi.mock('@/lib/db/repos/imap-cv-retries', () => ({
  listCvRetryStates: vi.fn(async () => new Map()),
  listCvRetryStatesForMailboxes: vi.fn(),
  clearCvRetryState: vi.fn(),
  upsertCvRetryState: vi.fn(),
}));
vi.mock('@/lib/db/repos/imap-unmatched-cvs', () => ({ insertUnmatchedCv: vi.fn(async () => true) }));
vi.mock('@/lib/storage/blob', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/blob')>()),
  uploadUnmatchedCvBinary: vi.fn(async () => ({ path: 'unmatched/x', bucket: 'artifacts' })),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/imap/client', () => ({ openConnection: vi.fn() }));

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { listCampaignLinksForMailbox, updateMailboxPollState, type MailboxRow } from '@/lib/db/repos/mailboxes';
import { openConnection } from '@/lib/imap/client';
import { IGNORED_MAIL_ACTION } from '@/lib/imap/mail-ignored';
import { pollMailbox } from '@/lib/imap/poller';

const journal = vi.mocked(appendJournalEntry);

type FakeMessage = { uid: number; source: Buffer };

function rawMail(subject: string, attachment?: { name: string; type: string }): Buffer {
  const head = [
    'From: Candidat <candidat@exemple.fr>',
    'To: recrutement@cabinet.fr',
    `Subject: ${subject}`,
    'Date: Thu, 01 Oct 2026 17:00:00 +0200',
    'MIME-Version: 1.0',
  ];
  if (!attachment) {
    return Buffer.from([...head, 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour.'].join('\r\n'));
  }
  return Buffer.from(
    [
      ...head,
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Veuillez trouver mon CV.',
      '--B',
      `Content-Type: ${attachment.type}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('%PDF-1.4 cv').toString('base64'),
      '--B--',
      '',
    ].join('\r\n'),
  );
}

function fakeServer(opts: { exists: number; uidNext: number; sinceUids: number[]; messages: FakeMessage[] }) {
  vi.mocked(openConnection).mockResolvedValue({
    mailbox: { exists: opts.exists, uidNext: opts.uidNext },
    getMailboxLock: async () => ({ release: () => {} }),
    search: async () => opts.sinceUids,
    async *fetch() {
      for (const m of opts.messages) yield m;
    },
    logout: async () => {},
    close: () => {},
  } as never);
}

function mailbox(over: Partial<MailboxRow> = {}): MailboxRow {
  return {
    id: 'mb1',
    label: 'Candidature',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_ssl: true,
    user_email: 'recrutement@cabinet.fr',
    encrypted_password: 'chiffré',
    is_enabled: true,
    folder: null,
    last_polled_at: null,
    last_uid_seen: '100',
    last_error: null,
    last_skip_reason: null,
    created_at: '2026-10-01T14:00:00.000Z',
    updated_at: '2026-10-01T14:00:00.000Z',
    ...over,
  };
}

const ignored = () => journal.mock.calls.map((c) => c[0]).filter((e) => e.action === IGNORED_MAIL_ACTION);
const action = (name: string) => journal.mock.calls.map((c) => c[0]).filter((e) => e.action === name);

beforeEach(() => {
  vi.clearAllMocks();
  journal.mockResolvedValue(undefined as never);
  vi.mocked(updateMailboxPollState).mockResolvedValue(undefined);
  vi.mocked(listCampaignLinksForMailbox).mockResolvedValue([
    { id: 'CAMP-2026-199', status: 'active' },
    { id: 'CAMP-2026-050', status: 'paused' },
  ]);
});

describe('chaque mail lu et non transformé en candidature laisse une ligne', () => {
  it('sans pièce jointe ⇒ no_attachment ; la charge ne porte NI objet NI expéditeur', async () => {
    fakeServer({ exists: 101, uidNext: 102, sinceUids: [], messages: [{ uid: 101, source: rawMail('Lettre d’information') }] });
    await pollMailbox(mailbox());
    expect(ignored()).toHaveLength(1);
    expect(ignored()[0]!.payload).toEqual({ mailboxId: 'mb1', uid: '101', reason: 'no_attachment' });
    expect(getCampaign).not.toHaveBeenCalled(); // aucune candidature
  });

  it('référence d’une campagne NON associée, avec CV ⇒ campaign_not_associated, et la trace dit la vérité', async () => {
    fakeServer({
      exists: 101,
      uidNext: 102,
      sinceUids: [],
      messages: [{ uid: 101, source: rawMail('Fw: CAMP-2026-777', { name: 'cv.pdf', type: 'application/pdf' }) }],
    });
    await pollMailbox(mailbox());
    expect(ignored().map((e) => e.payload?.reason)).toEqual(['campaign_not_associated']);
    const trace = action('imap_no_campaign_match')[0]!.payload!;
    expect(trace.foreignCampaignRefs).toEqual(['CAMP-2026-777']);
    expect(String(trace.reason)).toContain('non associée');
    expect(String(trace.reason)).not.toContain('aucun identifiant');
  });

  it('aucune référence, avec CV ⇒ no_campaign_match (CV stocké et rejouable, comme avant)', async () => {
    fakeServer({
      exists: 101,
      uidNext: 102,
      sinceUids: [],
      messages: [{ uid: 101, source: rawMail('Candidature', { name: 'cv.pdf', type: 'application/pdf' }) }],
    });
    await pollMailbox(mailbox());
    expect(ignored().map((e) => e.payload?.reason)).toEqual(['no_campaign_match']);
    expect(action('imap_no_campaign_match')).toHaveLength(1);
  });

  it('campagne associée mais NON active ⇒ campaign_inactive', async () => {
    fakeServer({
      exists: 101,
      uidNext: 102,
      sinceUids: [],
      messages: [{ uid: 101, source: rawMail('CAMP-2026-050', { name: 'cv.pdf', type: 'application/pdf' }) }],
    });
    await pollMailbox(mailbox());
    expect(ignored().map((e) => e.payload?.reason)).toEqual(['campaign_inactive']);
  });

  it('un uid DÉJÀ résolu que le serveur re-présente n’est pas un mail ignoré (pas une ligne par minute)', async () => {
    fakeServer({ exists: 100, uidNext: 101, sinceUids: [], messages: [{ uid: 100, source: rawMail('Ancien') }] });
    await pollMailbox(mailbox());
    expect(ignored()).toHaveLength(0);
  });
});

describe('la ligne de départ dit ce qu’elle laisse derrière elle', () => {
  it('boîte neuve : nombre de mails sous la ligne journalisé, sans en lire un seul', async () => {
    // 30 messages ; 2 reçus depuis le branchement (29, 30) ⇒ ligne à 28, 28 laissés.
    fakeServer({ exists: 30, uidNext: 31, sinceUids: [29, 30], messages: [] });
    await pollMailbox(mailbox({ last_uid_seen: null }));
    expect(action('imap_mailbox_baseline_set')[0]!.payload).toMatchObject({
      baselineUid: 28,
      countBelowBaseline: 28,
    });
    expect(ignored()).toHaveLength(0);
  });
});
