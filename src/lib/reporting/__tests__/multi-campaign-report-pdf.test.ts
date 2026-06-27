import { describe, expect, it } from 'vitest';

import { buildCampaignReportSummary, type CampaignReportMeta } from '@/lib/reporting/campaign-report';
import { buildMultiCampaignReportData } from '@/lib/reporting/multi-campaign-report';
import { renderMultiCampaignReportPdf } from '@/lib/reporting/multi-campaign-report-pdf';
import type { CampaignAnalysisDatum } from '@/types/reporting';

function datum(p: Partial<CampaignAnalysisDatum>): CampaignAnalysisDatum {
  return {
    status: 'accepted',
    totalScore: 80,
    source: 'linkedin',
    decisionZone: null,
    decidedBy: 'auto',
    humanIntervention: false,
    recruited: false,
    contacted: true,
    ...p,
  };
}

function fixture(reports: { id: string; analyses: CampaignAnalysisDatum[] }[]) {
  const units = reports.map((r) => {
    const meta: CampaignReportMeta = {
      campaignId: r.id,
      campaignName: `Campagne ${r.id}`,
      jobTitle: 'Développeur',
      launchedAt: '2026-01-01T00:00:00.000Z',
      closedAt: '2026-03-01T00:00:00.000Z',
      donneurOrdre: { label: 'M. Durand', role: 'DRH' },
      donneurOrdreId: 'DO-1',
      siteId: 'SITE-1',
      siteLabel: 'Paris',
    };
    return { summary: buildCampaignReportSummary(meta, r.analyses, [], null), analyses: r.analyses };
  });
  return buildMultiCampaignReportData({
    period: { from: '2026-01-01', to: '2026-03-31' },
    filters: { search: null, donneurLabel: 'M. Durand', siteLabel: 'Paris' },
    reports: units,
  });
}

describe('renderMultiCampaignReportPdf', () => {
  it('génère un PDF non vide avec plusieurs campagnes', async () => {
    const data = fixture([
      { id: 'A', analyses: [datum({ recruited: true }), datum({ status: 'rejected' })] },
      { id: 'B', analyses: [datum({ source: 'email' })] },
    ]);
    const pdf = await renderMultiCampaignReportPdf({
      data,
      generatedAtIso: '2026-06-15T12:32:00.000Z',
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rend même pour 0 campagne (période vide)', async () => {
    const data = fixture([]);
    expect(data.campaignCount).toBe(0);
    const pdf = await renderMultiCampaignReportPdf({
      data,
      generatedAtIso: '2026-06-15T12:32:00.000Z',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
