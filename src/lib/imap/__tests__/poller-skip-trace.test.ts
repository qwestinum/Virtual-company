/**
 * `imap_mailbox_skipped` — une trace par TRANSITION, jamais une par relève.
 *
 * La trace a été ajoutée le 20/08/2026 pour qu'une boîte sautée ne le soit plus
 * en silence : bonne intention. Mais réécrite à chaque poll sur une boîte
 * durablement en échec, elle produisait 1 440 lignes par jour — mesuré le
 * 21/08 : 475 des 500 lignes de la fenêtre du fil d'activité du Bureau, qui en
 * avait expulsé tous les évènements métier.
 *
 * L'invariant tenu ici : on signale le CHANGEMENT (première occurrence, ou
 * cause différente), l'état courant vivant déjà dans `last_error` /
 * `last_skip_reason`. La mémoire est en BASE — un marqueur en mémoire de
 * process ne verrait qu'une fraction des polls sur des invocations isolées.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crypto/mailbox-credentials', () => ({
  decryptCredential: () => 'mot-de-passe',
}));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn() }));
vi.mock('@/lib/db/repos/mailboxes', () => ({
  listCampaignsForMailbox: vi.fn(),
  updateMailboxPollState: vi.fn(),
  listEnabledMailboxes: vi.fn(),
}));

import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listCampaignsForMailbox,
  updateMailboxPollState,
} from '@/lib/db/repos/mailboxes';
import type { MailboxRow } from '@/lib/db/repos/mailboxes';
import { pollMailbox } from '@/lib/imap/poller';

const journal = vi.mocked(appendJournalEntry);
const associations = vi.mocked(listCampaignsForMailbox);
const updateState = vi.mocked(updateMailboxPollState);

function mailbox(over: Partial<MailboxRow> = {}): MailboxRow {
  return {
    id: 'mb1',
    label: 'Recrutement',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_ssl: true,
    user_email: 'recrutement@example.com',
    encrypted_password: 'chiffré',
    is_enabled: true,
    folder: null,
    last_polled_at: null,
    last_uid_seen: null,
    last_error: null,
    last_skip_reason: null,
    created_at: '2026-08-20T08:00:00.000Z',
    updated_at: '2026-08-20T08:00:00.000Z',
    ...over,
  };
}

const skips = () =>
  journal.mock.calls.filter((c) => c[0].action === 'imap_mailbox_skipped');

describe('trace des sauts de boîte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.mockResolvedValue(undefined as never);
    updateState.mockResolvedValue(undefined);
    // Boîte activée, rattachée à AUCUNE campagne : le saut le plus court.
    associations.mockResolvedValue([]);
  });

  it('PREMIER saut : journalisé, et la cause est mémorisée', async () => {
    await pollMailbox(mailbox());
    expect(skips()).toHaveLength(1);
    expect(skips()[0][0].payload).toMatchObject({
      mailboxId: 'mb1',
      label: 'Recrutement',
      reason: 'no_campaign_associated',
      previousReason: null,
    });
    expect(updateState).toHaveBeenCalledWith('mb1', {
      lastSkipReason: 'no_campaign_associated',
    });
  });

  it('saut RÉPÉTÉ à l’identique : AUCUNE nouvelle ligne', async () => {
    await pollMailbox(mailbox({ last_skip_reason: 'no_campaign_associated' }));
    expect(skips()).toHaveLength(0);
  });

  it('CHANGEMENT de cause : re-journalisé, avec la cause précédente', async () => {
    await pollMailbox(mailbox({ last_skip_reason: 'open_timeout' }));
    expect(skips()).toHaveLength(1);
    expect(skips()[0][0].payload).toMatchObject({
      reason: 'no_campaign_associated',
      previousReason: 'open_timeout',
    });
  });

  it('la trace DIT qu’elle vaut jusqu’au prochain changement', async () => {
    await pollMailbox(mailbox());
    expect(skips()[0][0].payload).toMatchObject({ repeatedUntilChange: true });
  });

  it('mémorisation en échec ⇒ la trace part quand même (doublon > saut muet)', async () => {
    // La cause est mémorisée APRÈS la trace, et son échec est absorbé : au
    // prochain poll on re-journalisera. Un doublon vaut mieux qu'un saut
    // jamais signalé — c'est tout l'objet de la trace.
    updateState.mockImplementation(async (_id, state) => {
      if (state.lastSkipReason !== undefined) throw new Error('DB indisponible');
    });
    await expect(pollMailbox(mailbox())).resolves.toBeTruthy();
    expect(skips()).toHaveLength(1);
  });

  it('cent relèves d’affilée sur la même cause : UNE seule ligne', async () => {
    // Le scénario exact de la prod : la première relève trace, les suivantes
    // se taisent. C'est ce qui empêche 1 440 lignes/jour d'évincer le métier.
    let memorized: string | null = null;
    updateState.mockImplementation(async (_id, state) => {
      if (state.lastSkipReason !== undefined) memorized = state.lastSkipReason;
    });
    for (let i = 0; i < 100; i++) {
      await pollMailbox(mailbox({ last_skip_reason: memorized }));
    }
    expect(skips()).toHaveLength(1);
  });
});
