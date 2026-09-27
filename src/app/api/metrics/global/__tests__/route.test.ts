/**
 * GET /api/metrics/global — sans fil d'activité, sans sondage (27/09/2026).
 *
 * Historique : le 21/08/2026, le fil se vidait (fenêtre brute noyée de lignes
 * techniques) ; la route avait appris à ne lire que les évènements affichables.
 * Le 27/09/2026, le diagnostic d'egress a retiré le fil tout entier : son seul
 * écran (Pilotage → Activité) n'existe plus, et la route, relue toutes les 5 s
 * même onglet caché, sortait ~1,8 Go/jour par onglet oublié. Ce test tient :
 * aucune lecture pour un fil, aucune clé `activity` rendue, et aucun sondage
 * possible depuis le hook.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { AGENT_METRIC_ACTIONS } from '@/lib/dashboard/derive-metrics';
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

describe('GET /api/metrics/global — sans fil d’activité', () => {
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

  it('un member : AUCUNE lecture ciblée (ni fil, ni métriques agents) et aucune clé `activity`', async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(targeted).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('activity');
  });

  it('un admin : la seule lecture ciblée est celle des métriques agents', async () => {
    admin.mockResolvedValue({ id: 'u1' } as never);
    await GET();
    expect(targeted).toHaveBeenCalledTimes(1);
    expect(targeted).toHaveBeenCalledWith(AGENT_METRIC_ACTIONS, expect.any(Number));
  });

  it('Supabase absent ⇒ payload offline cohérent, sans fil', async () => {
    rawWindow.mockResolvedValue(null);
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body.offline).toBe(true);
    expect(body).not.toHaveProperty('activity');
  });

  it('garde structurelle : le hook ne peut plus sonder la route', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/useDashboardData.ts'), 'utf8');
    expect(src).not.toMatch(/setInterval|POLL_INTERVAL/);
  });
});
