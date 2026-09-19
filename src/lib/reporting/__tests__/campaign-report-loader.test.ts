/**
 * Assemblage du rapport de campagne : la clé du cache se calcule sur la
 * campagne seule (identique au nom rendu par l'assemblage), et les lectures
 * lancées en parallèle gardent la précédence d'erreur de la version séquentielle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({ listAllCandidateAnalyses: vi.fn() }));
vi.mock('@/lib/db/repos/donneurs-ordre', () => ({ getDonneurOrdre: vi.fn() }));
vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntries: vi.fn(),
  listJournalEntriesByActions: vi.fn(),
  appendJournalEntry: vi.fn(),
}));
vi.mock('@/lib/db/repos/sites', () => ({ getSite: vi.fn() }));
vi.mock('@/lib/db/repos/vivier-preselection', () => ({
  countVivierMetricsForCampaign: vi.fn(),
}));
vi.mock('@/lib/reporting/journey-lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reporting/journey-lookup')>()),
  loadJourneySignals: vi.fn(),
}));

import { getCampaign } from '@/lib/db/repos/campaigns';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { getDonneurOrdre } from '@/lib/db/repos/donneurs-ordre';
import { listJournalEntries, listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { getSite } from '@/lib/db/repos/sites';
import { countVivierMetricsForCampaign } from '@/lib/db/repos/vivier-preselection';
import { loadJourneySignals } from '@/lib/reporting/journey-lookup';

import {
  assembleCampaignReport,
  campaignReportFileNameOf,
  loadReportableCampaign,
} from '../campaign-report-loader';

const CAMPAIGN = {
  id: 'CAMP-2026-100',
  name: 'Comptable',
  status: 'closed',
  fdp: { fields: { job_title: { value: 'Comptable général' } } },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  launchedAt: '2026-06-02T00:00:00.000Z',
  closedAt: '2026-07-31T18:00:00.000Z',
  donneurOrdreId: 'DO-1',
  siteId: 'SITE-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(listAllCandidateAnalyses).mockResolvedValue([]);
  vi.mocked(loadJourneySignals).mockResolvedValue({
    markers: new Map(),
    pendingUids: new Set(),
  });
  vi.mocked(listJournalEntries).mockResolvedValue([]);
  vi.mocked(listJournalEntriesByActions).mockResolvedValue([]);
  vi.mocked(countVivierMetricsForCampaign).mockResolvedValue({ contacted: 0 } as never);
  vi.mocked(getDonneurOrdre).mockResolvedValue({
    firstName: 'Jane',
    lastName: 'R.',
    role: 'DAF',
  } as never);
  vi.mocked(getSite).mockResolvedValue({ name: 'Tours' } as never);
});

describe('clé du cache', () => {
  it('le nom calculé sur la campagne est celui de l’assemblage', async () => {
    const report = await assembleCampaignReport(CAMPAIGN.id);
    expect(report?.fileName).toBe(campaignReportFileNameOf(CAMPAIGN as never));
    expect(report?.data.summary.donneurOrdre?.label).toBe('Jane R.');
    expect(report?.data.summary.siteLabel).toBe('Tours');
  });

  it('une campagne non clôturée n’est pas rapportable', async () => {
    vi.mocked(getCampaign).mockResolvedValue({ ...CAMPAIGN, status: 'active' } as never);
    expect(await loadReportableCampaign(CAMPAIGN.id)).toBeNull();
    expect(await assembleCampaignReport(CAMPAIGN.id)).toBeNull();
  });

  it('la campagne pré-chargée n’est pas relue', async () => {
    await assembleCampaignReport(CAMPAIGN.id, { campaign: CAMPAIGN as never });
    expect(getCampaign).not.toHaveBeenCalled();
  });
});

describe('précédence des erreurs', () => {
  it('l’échec d’une lecture principale prime sur celui du donneur d’ordre', async () => {
    vi.mocked(listAllCandidateAnalyses).mockRejectedValue(new Error('analyses KO'));
    vi.mocked(getDonneurOrdre).mockRejectedValue(new Error('donneur KO'));
    await expect(assembleCampaignReport(CAMPAIGN.id)).rejects.toThrow('analyses KO');
  });

  it('le donneur d’ordre en échec fait toujours échouer l’assemblage', async () => {
    vi.mocked(getDonneurOrdre).mockRejectedValue(new Error('donneur KO'));
    await expect(assembleCampaignReport(CAMPAIGN.id)).rejects.toThrow('donneur KO');
  });

  it('le site en échec aussi, après le donneur', async () => {
    vi.mocked(getDonneurOrdre).mockRejectedValue(new Error('donneur KO'));
    vi.mocked(getSite).mockRejectedValue(new Error('site KO'));
    await expect(assembleCampaignReport(CAMPAIGN.id)).rejects.toThrow('donneur KO');
  });
});

describe('indicateur « décisions finales motivées » (indicateur seul, jamais le contenu)', () => {
  const analysis = (uid: string) =>
    ({
      id: `can_${uid}`,
      uid,
      status: 'accepted',
      totalScore: 80,
      source: 'email',
      decisionZone: 'auto_accept',
      decidedBy: 'auto',
      dismissedAt: null,
    }) as never;
  const marker = (uid: string, status: string, at: string, commentId?: string) => ({
    id: `j_${uid}_${at}`,
    campaignId: CAMPAIGN.id,
    actor: 'user',
    action: 'candidate_validation_marked',
    payload: { uid, status, ...(commentId ? { commentId } : {}) },
    createdAt: at,
  });

  it('compte les verdicts COURANTS et ceux qui portent leur commentaire', async () => {
    vi.mocked(listAllCandidateAnalyses).mockResolvedValue([
      analysis('u1'),
      analysis('u2'),
      analysis('u3'),
    ]);
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      marker('u1', 'validated', '2026-07-10T10:00:00.000Z', 'c1'),
      marker('u2', 'rejected', '2026-07-11T10:00:00.000Z', 'c2'),
      // u3 : GO motivé PUIS corrigé sans commentaire ⇒ verdict non motivé.
      marker('u3', 'validated', '2026-07-12T10:00:00.000Z', 'c3'),
      marker('u3', 'rejected', '2026-07-13T10:00:00.000Z'),
      // Marqueur d'une candidature hors campagne : ignoré.
      marker('autre', 'validated', '2026-07-12T10:00:00.000Z', 'c9'),
    ] as never);
    const report = await assembleCampaignReport(CAMPAIGN.id);
    expect(report?.data.motivatedDecisions).toEqual({ total: 3, motivated: 2 });
  });

  it('campagne antérieure à la règle (aucun verdict motivé) : pas d’indicateur', async () => {
    vi.mocked(listAllCandidateAnalyses).mockResolvedValue([analysis('u1')]);
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      marker('u1', 'validated', '2026-07-10T10:00:00.000Z'),
    ] as never);
    const report = await assembleCampaignReport(CAMPAIGN.id);
    expect(report?.data.motivatedDecisions).toBeNull();
  });

  it('journal illisible : la ligne disparaît, le rapport reste', async () => {
    vi.mocked(listJournalEntriesByActions).mockRejectedValue(new Error('journal KO'));
    const report = await assembleCampaignReport(CAMPAIGN.id);
    expect(report).not.toBeNull();
    expect(report?.data.motivatedDecisions).toBeNull();
  });
});
