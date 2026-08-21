/**
 * Régression du 21/08/2026 — le fil d'activité du Bureau se vidait.
 *
 * Cause : la route chargeait les 500 dernières lignes BRUTES du journal, puis
 * `journalToActivityFeed` jetait celles qu'il ne savait pas rendre. Une action
 * technique écrite à chaque relève (`imap_mailbox_skipped`, 1 440 lignes/jour
 * sur une boîte en timeout permanent) remplissait la fenêtre et EXPULSAIT les
 * évènements métier derrière son bord. Le fil n'accumule rien côté client : ce
 * qui sort de la fenêtre disparaît de l'écran.
 *
 * Ce test tient l'invariant : la limite porte sur les évènements AFFICHABLES,
 * jamais sur le journal brut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-api-user', () => ({ getAdminApiUser: vi.fn() }));
vi.mock('@/lib/imap/scheduler', () => ({ ensureSchedulerStarted: vi.fn() }));
vi.mock('@/lib/db/repos/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  listPendingValidations: vi.fn(),
}));
vi.mock('@/lib/dashboard/zone-counts', () => ({ zoneDistribution: vi.fn() }));
vi.mock('@/lib/db/repos/metrics', () => ({
  fetchMetricsRows: vi.fn(),
  fetchCandidateTotalRows: vi.fn(),
  fetchRecentRowsForActions: vi.fn(),
}));

import { getAdminApiUser } from '@/lib/auth/require-api-user';
import {
  ACTIVITY_FEED_ACTIONS,
  AGENT_METRIC_ACTIONS,
} from '@/lib/dashboard/derive-metrics';
import { zoneDistribution } from '@/lib/dashboard/zone-counts';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import type { JournalEntry } from '@/lib/db/repos/journal';
import {
  fetchCandidateTotalRows,
  fetchMetricsRows,
  fetchRecentRowsForActions,
} from '@/lib/db/repos/metrics';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { GET } from '@/app/api/metrics/global/route';

const admin = vi.mocked(getAdminApiUser);
const rawWindow = vi.mocked(fetchMetricsRows);
const totals = vi.mocked(fetchCandidateTotalRows);
const targeted = vi.mocked(fetchRecentRowsForActions);

function entry(over: Partial<JournalEntry>): JournalEntry {
  return {
    id: 1,
    campaignId: 'CAMP-2026-511',
    actor: 'imap_poller',
    action: 'imap_mailbox_skipped',
    payload: {},
    createdAt: '2026-08-21T14:30:00.000Z',
    ...over,
  };
}

/** La fenêtre brute telle qu'elle était en prod : 95 % de bruit technique. */
const NOISY_RAW_WINDOW: JournalEntry[] = [
  ...Array.from({ length: 475 }, (_, i) =>
    entry({ id: i, payload: { reason: 'open_timeout' } }),
  ),
];

const BUSINESS_ROWS: JournalEntry[] = Array.from({ length: 50 }, (_, i) =>
  entry({
    id: 1000 + i,
    action: 'candidate_interview_marked',
    payload: { candidate: `Candidat ${i}`, status: 'realized' },
  }),
);

describe('GET /api/metrics/global — fil d’activité', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockResolvedValue(null);
    rawWindow.mockResolvedValue({ rows: NOISY_RAW_WINDOW });
    totals.mockResolvedValue({ rows: [] });
    targeted.mockResolvedValue({ rows: BUSINESS_ROWS });
    vi.mocked(listCampaigns).mockResolvedValue([]);
    vi.mocked(listPendingValidations).mockResolvedValue([]);
    vi.mocked(zoneDistribution).mockResolvedValue({
      autoReject: 0,
      autoAccept: 0,
      humanValidated: 0,
      pending: 0,
      sansSuite: 0,
      total: 0,
    });
  });

  it('demande les évènements AFFICHABLES, pas les lignes brutes', async () => {
    await GET();
    expect(targeted).toHaveBeenCalledWith(
      ACTIVITY_FEED_ACTIONS,
      expect.any(Number),
    );
    // Et l'action qui avait saturé la fenêtre n'est pas demandée.
    expect(ACTIVITY_FEED_ACTIONS).not.toContain('imap_mailbox_skipped');
  });

  it('rend bien 50 items malgré un journal noyé de lignes techniques', async () => {
    const body = (await (await GET()).json()) as { activity: unknown[] };
    expect(body.activity).toHaveLength(50);
  });

  it('charge une marge de lignes — certaines sont écartées sur leur CONTENU', async () => {
    await GET();
    const [, limit] = targeted.mock.calls[0];
    expect(limit).toBeGreaterThan(50);
  });

  it('un member ne paie pas la requête des métriques agents', async () => {
    await GET();
    const actionLists = targeted.mock.calls.map(([actions]) => actions);
    expect(actionLists).toHaveLength(1);
    expect(actionLists[0]).toBe(ACTIVITY_FEED_ACTIONS);
  });

  it('un admin obtient les métriques agents sur les actions d’agent SEULES', async () => {
    admin.mockResolvedValue({ id: 'u1' } as never);
    await GET();
    expect(targeted).toHaveBeenCalledWith(
      AGENT_METRIC_ACTIONS,
      expect.any(Number),
    );
  });

  it('fetch ciblé en échec ⇒ repli sur la fenêtre brute, jamais un fil vide', async () => {
    targeted.mockRejectedValue(new Error('hoquet DB'));
    rawWindow.mockResolvedValue({
      rows: [...BUSINESS_ROWS.slice(0, 3), ...NOISY_RAW_WINDOW],
    });
    const body = (await (await GET()).json()) as { activity: unknown[] };
    expect(body.activity).toHaveLength(3);
  });

  it('Supabase absent ⇒ payload offline cohérent', async () => {
    rawWindow.mockResolvedValue(null);
    const body = (await (await GET()).json()) as {
      offline: boolean;
      activity: unknown[];
    };
    expect(body.offline).toBe(true);
    expect(body.activity).toEqual([]);
  });
});
