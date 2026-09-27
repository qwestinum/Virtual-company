/**
 * Poids d'un tick de relève (diagnostic d'egress du 25/09/2026).
 *
 * Avant : boîtes, puis PAR BOÎTE les rattachements, la liste COMPLÈTE des
 * campagnes (`select *`, 60 Ko compressés) et les réessais — à chaque tick,
 * même sans aucun mail. Ce que ce fichier tient :
 *   - UNE lecture (boîtes + campagnes réduites à id/statut) + UNE pour les
 *     réessais, quel que soit le nombre de boîtes ;
 *   - ZÉRO lecture tant qu'aucune boîte n'est due ;
 *   - jamais la liste complète des campagnes, ni le dossier d'une campagne
 *     tant qu'aucun mail n'est rapproché.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crypto/mailbox-credentials', () => ({ decryptCredential: () => 'mot-de-passe' }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => undefined) }));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/imap-cv-retries', () => ({
  clearCvRetryState: vi.fn(),
  listCvRetryStates: vi.fn(async () => new Map()),
  listCvRetryStatesForMailboxes: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, new Map()]))),
  upsertCvRetryState: vi.fn(),
}));
vi.mock('@/lib/db/repos/mailboxes', () => ({
  listEnabledMailboxesForPoll: vi.fn(),
  listCampaignLinksForMailbox: vi.fn(),
  updateMailboxPollState: vi.fn(async () => undefined),
}));

import { getCampaign } from '@/lib/db/repos/campaigns';
import { listCvRetryStatesForMailboxes } from '@/lib/db/repos/imap-cv-retries';
import { listCampaignLinksForMailbox, listEnabledMailboxesForPoll, type MailboxRow } from '@/lib/db/repos/mailboxes';
import { __resetPollScheduleForTests, pollAllMailboxes } from '@/lib/imap/poller';

const read = vi.mocked(listEnabledMailboxesForPoll);
const retries = vi.mocked(listCvRetryStatesForMailboxes);

function mailbox(id: string, lastPolledAt: string | null): MailboxRow {
  return {
    id, label: id, imap_host: 'imap.example.com', imap_port: 993, imap_ssl: true,
    user_email: `${id}@example.com`, encrypted_password: 'x', is_enabled: true, folder: null,
    last_polled_at: lastPolledAt, last_uid_seen: null, last_error: null, last_skip_reason: null,
    created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  };
}

describe('tick de relève allégé', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPollScheduleForTests();
    globalThis.__imapPollInFlight__ = false;
  });

  it('deux boîtes dues : UNE lecture des boîtes, UNE des réessais, aucune liste de campagnes', async () => {
    // Boîtes sans campagne rattachée : la relève s'arrête avant IMAP.
    read.mockResolvedValue([
      { mailbox: mailbox('a', null), campaigns: [] },
      { mailbox: mailbox('b', null), campaigns: [] },
    ]);
    await pollAllMailboxes();
    expect(read).toHaveBeenCalledTimes(1);
    expect(retries).toHaveBeenCalledTimes(1);
    expect(retries.mock.calls[0]![0]).toEqual(['a', 'b']);
    // Rattachements déjà lus avec les boîtes : pas de relecture par boîte.
    expect(listCampaignLinksForMailbox).not.toHaveBeenCalled();
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it('ZÉRO lecture tant qu’aucune boîte n’est due ; la relève manuelle (`force`) passe outre', async () => {
    read.mockResolvedValue([{ mailbox: mailbox('a', null), campaigns: [] }]);
    await pollAllMailboxes();
    expect(read).toHaveBeenCalledTimes(1);
    await pollAllMailboxes(); // aussitôt après : rien n'est dû
    expect(read).toHaveBeenCalledTimes(1);
    await pollAllMailboxes({ force: true });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('une boîte relevée par l’AUTRE releveur il y a 10 s n’est pas relevée (ni réessais lus)', async () => {
    read.mockResolvedValue([{ mailbox: mailbox('a', new Date(Date.now() - 10_000).toISOString()), campaigns: [] }]);
    const out = await pollAllMailboxes();
    expect(out).toEqual([]);
    expect(retries).not.toHaveBeenCalled();
  });

  it('garde structurelle : le poller ne lit JAMAIS la liste complète des campagnes', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/imap/poller.ts'), 'utf8');
    expect(src).not.toMatch(/\blistCampaigns\b/);
  });
});
