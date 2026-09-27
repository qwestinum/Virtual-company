/**
 * GET /api/cron/imap-poll — garde par projet (`CRON_ENABLED`) puis
 * authentification fail-closed (`CRON_SECRET`), déclenchée par Vercel Cron.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/imap/poller', () => ({
  pollAllMailboxes: vi.fn().mockResolvedValue([{ mailboxId: 'm1' }]),
}));
vi.mock('@/lib/scheduling-host/drain', () => ({ drainSchedulingEvents: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/sourcing/server/maintenance', () => ({ runSourcingMaintenance: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/candidatures/dismissal-batch', () => ({ runQueuedClosureDismissals: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn() }));

import { runQueuedClosureDismissals } from '@/lib/candidatures/dismissal-batch';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { pollAllMailboxes } from '@/lib/imap/poller';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';
import { runSourcingMaintenance } from '@/lib/sourcing/server/maintenance';
import { GET } from '@/app/api/cron/imap-poll/route';

const pollMock = vi.mocked(pollAllMailboxes);
const anyWork = () =>
  [pollAllMailboxes, drainSchedulingEvents, runSourcingMaintenance, runQueuedClosureDismissals, appendJournalEntry].some(
    (f) => vi.mocked(f).mock.calls.length > 0,
  );

/** L'appel tel que Vercel Cron le fait : GET, `Authorization: Bearer <CRON_SECRET>`, user-agent dédié. */
function vercelCron(secret: string | null): Request {
  const headers: Record<string, string> = { 'user-agent': 'vercel-cron/1.0' };
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return new Request('https://orqa.example/api/cron/imap-poll', { method: 'GET', headers });
}

const saved = { secret: process.env.CRON_SECRET, enabled: process.env.CRON_ENABLED };

describe('GET /api/cron/imap-poll', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const [k, v] of [['CRON_SECRET', saved.secret], ['CRON_ENABLED', saved.enabled]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('garde par projet — CRON_ENABLED', () => {
    it.each([
      ['absente', undefined],
      ['« 0 »', '0'],
      ['« true » (valeur stricte : 1 seulement)', 'true'],
    ])('%s ⇒ 200 { enabled: false }, AUCUNE lecture ni écriture, aucun journal', async (_label, value) => {
      process.env.CRON_SECRET = 's3cr3t';
      if (value === undefined) delete process.env.CRON_ENABLED;
      else process.env.CRON_ENABLED = value;
      const res = await GET(vercelCron('s3cr3t'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ enabled: false });
      expect(anyWork()).toBe(false);
    });

    it('absente ET sans CRON_SECRET (la dev) ⇒ 200 silencieux, pas une erreur 500 à chaque minute', async () => {
      delete process.env.CRON_ENABLED;
      delete process.env.CRON_SECRET;
      const res = await GET(vercelCron(null));
      expect(res.status).toBe(200);
      expect(anyWork()).toBe(false);
    });

    it('« 1 » ⇒ la relève tourne (comportement inchangé)', async () => {
      process.env.CRON_ENABLED = '1';
      process.env.CRON_SECRET = 's3cr3t';
      const res = await GET(vercelCron('s3cr3t'));
      expect(res.status).toBe(200);
      expect(pollMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('authentification — CRON_SECRET (fail-closed), en-tête injecté par Vercel', () => {
    beforeEach(() => {
      process.env.CRON_ENABLED = '1';
    });

    it('secret ABSENT du projet ⇒ 500 `cron_not_configured`, jamais de relève', async () => {
      delete process.env.CRON_SECRET;
      const res = await GET(vercelCron('nimporte'));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('cron_not_configured');
      expect(pollMock).not.toHaveBeenCalled();
    });

    it('mauvais secret, ou aucun en-tête ⇒ 401, jamais de relève', async () => {
      process.env.CRON_SECRET = 's3cr3t';
      expect((await GET(vercelCron('nope'))).status).toBe(401);
      expect((await GET(vercelCron(null))).status).toBe(401);
      expect(pollMock).not.toHaveBeenCalled();
    });

    it('bon secret, tel que Vercel l’envoie (`Authorization: Bearer …`, casse d’en-tête indifférente) ⇒ 200', async () => {
      process.env.CRON_SECRET = 's3cr3t';
      expect((await GET(vercelCron('s3cr3t'))).status).toBe(200);
      const upper = new Request('https://orqa.example/api/cron/imap-poll', { headers: { Authorization: 'Bearer s3cr3t' } });
      expect((await GET(upper)).status).toBe(200);
      expect(pollMock).toHaveBeenCalledTimes(2);
    });
  });
});
