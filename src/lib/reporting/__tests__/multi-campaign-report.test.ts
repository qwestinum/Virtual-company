import { describe, expect, it } from 'vitest';

import { buildCampaignReportSummary, type CampaignReportMeta } from '@/lib/reporting/campaign-report';
import {
  aggregatePreview,
  buildMultiCampaignReportData,
  type CampaignReportUnit,
} from '@/lib/reporting/multi-campaign-report';
import type { CampaignAnalysisDatum } from '@/types/reporting';

function datum(p: Partial<CampaignAnalysisDatum>): CampaignAnalysisDatum {
  return {
    status: 'accepted',
    totalScore: 80,
    source: 'email',
    humanIntervention: false,
    recruited: false,
    contacted: false,
    ...p,
  };
}

function unit(p: {
  id: string;
  jobTitle?: string;
  siteId?: string | null;
  siteLabel?: string | null;
  donneurLabel?: string;
  launchedAt?: string;
  closedAt?: string;
  analyses: CampaignAnalysisDatum[];
}): CampaignReportUnit {
  const meta: CampaignReportMeta = {
    campaignId: p.id,
    campaignName: p.jobTitle ?? `Campagne ${p.id}`,
    jobTitle: p.jobTitle ?? 'Poste',
    launchedAt: p.launchedAt ?? '2026-03-01T00:00:00.000Z',
    closedAt: p.closedAt ?? '2026-03-20T00:00:00.000Z',
    donneurOrdre: p.donneurLabel ? { label: p.donneurLabel, role: null } : null,
    donneurOrdreId: null,
    siteId: p.siteId ?? null,
    siteLabel: p.siteLabel ?? null,
  };
  return {
    summary: buildCampaignReportSummary(meta, p.analyses, [], null),
    analyses: p.analyses,
  };
}

const PERIOD = { from: '2026-01-01', to: '2026-12-31' };
const NO_FILTERS = { search: null, donneurLabel: null, siteLabel: null };

function build(reports: CampaignReportUnit[]) {
  return buildMultiCampaignReportData({ period: PERIOD, filters: NO_FILTERS, reports });
}

describe('aggregatePreview', () => {
  it('cumule campagnes / reçues / retenus / recrutements', () => {
    const u1 = unit({ id: 'A', analyses: [datum({}), datum({ status: 'rejected' })] });
    const u2 = unit({ id: 'B', analyses: [datum({ recruited: true })] });
    expect(aggregatePreview([u1.summary, u2.summary])).toEqual({
      campaignCount: 2,
      totalReceived: 3,
      totalRetained: 2,
      totalRecruited: 1,
    });
  });
});

describe('buildMultiCampaignReportData — agrégats', () => {
  it('volumes cumulés + taux pondérés + tri par clôture décroissante', () => {
    const data = build([
      unit({ id: 'A', closedAt: '2026-04-01T00:00:00Z', analyses: [datum({}), datum({ status: 'rejected' })] }),
      unit({ id: 'B', closedAt: '2026-06-01T00:00:00Z', analyses: [datum({ recruited: true, contacted: true })] }),
    ]);
    expect(data.aggregateVolumes).toEqual({ received: 3, retained: 2, rejected: 1, arbitrated: 0 });
    expect(data.campaignCount).toBe(2);
    expect(data.totalRecruited).toBe(1);
    expect(data.rates.retentionRate).toBe(67); // 2/3
    expect(data.perCampaign[0]!.campaignId).toBe('B'); // clôture la plus récente
    expect(data.rgpd.totalCandidates).toBe(3);
  });

  it('time-to-hire moyen calculé sur les campagnes ayant recruté', () => {
    const data = build([
      unit({ id: 'A', launchedAt: '2026-01-01T00:00:00Z', closedAt: '2026-03-01T00:00:00Z', analyses: [datum({ recruited: true })] }),
      unit({ id: 'B', analyses: [datum({ status: 'rejected' })] }), // pas de recrutement → exclue
    ]);
    expect(data.rates.avgTimeToHireDays).toBe(59); // ~jan→mars, B exclue
  });

  it('aucune campagne → agrégats à zéro, une reco fallback', () => {
    const data = build([]);
    expect(data.campaignCount).toBe(0);
    expect(data.aggregateVolumes.received).toBe(0);
    expect(data.rates.retentionRate).toBe(0);
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it('une seule campagne reste agrégeable', () => {
    const data = build([unit({ id: 'A', analyses: [datum({ recruited: true })] })]);
    expect(data.campaignCount).toBe(1);
    expect(data.perCampaign).toHaveLength(1);
  });
});

describe('recommandations transverses (règles)', () => {
  it('canal dominant (≥ 40% des retenus)', () => {
    const data = build([
      unit({
        id: 'A',
        analyses: [
          datum({ source: 'linkedin', status: 'accepted' }),
          datum({ source: 'linkedin', status: 'accepted' }),
          datum({ source: 'linkedin', status: 'accepted' }),
          datum({ source: 'email', status: 'accepted' }),
        ],
      }),
    ]);
    expect(data.recommendations.join(' ')).toMatch(/LinkedIn.*75%|75%.*LinkedIn/);
  });

  it('≥ 2 campagnes lentes (time-to-hire > 45 j)', () => {
    const slow = (id: string) =>
      unit({
        id,
        launchedAt: '2026-01-01T00:00:00Z',
        closedAt: '2026-04-01T00:00:00Z', // ~90 j
        analyses: [datum({ recruited: true })],
      });
    const data = build([slow('A'), slow('B')]);
    expect(data.recommendations.join(' ')).toMatch(/time-to-hire supérieur à 45/i);
  });

  it('arbitrage manuel global élevé (≥ 20%)', () => {
    const data = build([
      unit({
        id: 'A',
        analyses: [
          datum({ humanIntervention: true }),
          datum({ humanIntervention: true }),
          datum({}),
          datum({}),
        ],
      }),
    ]);
    expect(data.rates.arbitrationRate).toBe(0.5);
    expect(data.recommendations.join(' ')).toMatch(/arbitrage manuel/i);
  });

  it('divergence de taux de retenue entre sites (> 20 pts)', () => {
    const data = build([
      unit({ id: 'A', siteLabel: 'Paris', analyses: [datum({ status: 'accepted' }), datum({ status: 'accepted' })] }),
      unit({ id: 'B', siteLabel: 'Lyon', analyses: [datum({ status: 'rejected' }), datum({ status: 'rejected' })] }),
    ]);
    const joined = data.recommendations.join(' ');
    expect(joined).toMatch(/Paris/);
    expect(joined).toMatch(/Lyon/);
    expect(joined).toMatch(/harmonisation/i);
  });

  it('canaux sans aucun retenu signalés', () => {
    const data = build([
      unit({
        id: 'A',
        analyses: [
          datum({ source: 'linkedin', status: 'accepted' }),
          datum({ source: 'indeed', status: 'rejected' }),
        ],
      }),
    ]);
    expect(data.underperformingChannelLabels).toContain('Indeed');
    expect(data.recommendations.join(' ')).toMatch(/Indeed/);
  });

  it('plafonne à 5 recommandations', () => {
    const data = build([
      unit({ id: 'A', siteLabel: 'Paris', launchedAt: '2026-01-01T00:00:00Z', closedAt: '2026-04-01T00:00:00Z', analyses: [datum({ source: 'linkedin', status: 'accepted', recruited: true }), datum({ source: 'indeed', status: 'rejected', humanIntervention: true })] }),
      unit({ id: 'B', siteLabel: 'Lyon', launchedAt: '2026-01-01T00:00:00Z', closedAt: '2026-04-01T00:00:00Z', analyses: [datum({ status: 'rejected', humanIntervention: true, recruited: false })] }),
    ]);
    expect(data.recommendations.length).toBeLessThanOrEqual(5);
  });
});
