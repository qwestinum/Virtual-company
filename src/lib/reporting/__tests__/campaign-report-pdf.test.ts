import { describe, expect, it } from 'vitest';

import {
  buildCampaignReportData,
  buildCampaignReportSummary,
  type CampaignReportMeta,
} from '@/lib/reporting/campaign-report';
import { campaignSendDefaults } from '@/lib/reporting/campaign-report-display';
import { renderCampaignReportPdf } from '@/lib/reporting/campaign-report-pdf';
import type { CampaignAnalysisDatum } from '@/types/reporting';

const META: CampaignReportMeta = {
  campaignId: 'CAMP-7',
  campaignName: 'Campagne dev',
  jobTitle: 'Développeur Front',
  launchedAt: '2026-03-01T00:00:00.000Z',
  closedAt: '2026-06-01T00:00:00.000Z',
  donneurOrdre: { label: 'M. Durand', role: 'DRH' },
  donneurOrdreId: 'DO-1',
  siteId: 'SITE-1',
  siteLabel: 'Paris',
};

const ANALYSES: CampaignAnalysisDatum[] = [
  { status: 'accepted', totalScore: 88, source: 'linkedin', humanIntervention: false, recruited: true, contacted: true },
  { status: 'accepted', totalScore: 72, source: 'email', humanIntervention: true, recruited: false, contacted: true },
  { status: 'rejected', totalScore: 40, source: 'email', humanIntervention: false, recruited: false, contacted: false },
];

function fixtureData() {
  const summary = buildCampaignReportSummary(META, ANALYSES, [], null);
  return buildCampaignReportData(summary, ANALYSES);
}

describe('renderCampaignReportPdf', () => {
  it('génère un PDF non vide (magic %PDF) avec une fixture complète', async () => {
    const pdf = await renderCampaignReportPdf({
      data: fixtureData(),
      generatedAtIso: '2026-06-10T09:00:00.000Z',
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rend même pour une campagne sans candidature (cas limite)', async () => {
    const summary = buildCampaignReportSummary(META, [], [], null);
    const data = buildCampaignReportData(summary, []);
    expect(data.lowVolume).toBe(true);
    const pdf = await renderCampaignReportPdf({
      data,
      generatedAtIso: '2026-06-10T09:00:00.000Z',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('campaignSendDefaults (contexte rapport de campagne)', () => {
  it('sujet rappelle la campagne (pas juste le poste), message et PJ corrects', () => {
    const summary = buildCampaignReportSummary(META, ANALYSES, [], null);
    const d = campaignSendDefaults(summary);
    // Rappel de la campagne : intitulé distinct + identifiant.
    expect(d.subject).toBe(
      'Rapport de campagne — Développeur Front (Campagne dev · CAMP-7)',
    );
    expect(d.message).toMatch(/« Développeur Front »/);
    expect(d.message).toMatch(/clôturée le 1 juin 2026/);
    expect(d.attachmentName).toBe(
      'ORQA-rapport-campagne-developpeur-front-2026-06-01.pdf',
    );
  });
});
