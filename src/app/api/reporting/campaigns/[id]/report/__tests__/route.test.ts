/**
 * PDF du rapport de campagne : le cache est consulté AVANT l'assemblage. Un
 * cache présent est resservi à l'identique sans rien assembler ; un cache
 * absent suit exactement le chemin d'avant (rendu, mise en cache, journal).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reporting/campaign-report-loader', () => ({
  loadReportableCampaign: vi.fn(),
  campaignReportFileNameOf: vi.fn(() => 'ORQA-rapport-campagne-comptable-2026-07-31.pdf'),
  assembleCampaignReport: vi.fn(),
}));
vi.mock('@/lib/storage/blob', () => ({
  downloadArtifact: vi.fn(),
  uploadArtifactBinary: vi.fn(),
}));
vi.mock('@/lib/reporting/campaign-report-pdf', () => ({ renderCampaignReportPdf: vi.fn() }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn() }));

import { GET } from '@/app/api/reporting/campaigns/[id]/report/route';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  assembleCampaignReport,
  loadReportableCampaign,
} from '@/lib/reporting/campaign-report-loader';
import { renderCampaignReportPdf } from '@/lib/reporting/campaign-report-pdf';
import { downloadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';

const ID = 'CAMP-2026-100';
const FILE = 'ORQA-rapport-campagne-comptable-2026-07-31.pdf';
const params = { params: Promise.resolve({ id: ID }) };
const call = (qs = '') =>
  GET(new Request(`http://localhost/api/reporting/campaigns/${ID}/report${qs}`), params);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadReportableCampaign).mockResolvedValue({ id: ID } as never);
  vi.mocked(assembleCampaignReport).mockResolvedValue({
    data: {},
    fileName: FILE,
    jobTitle: 'Comptable',
    closedAt: '2026-07-31',
  } as never);
  vi.mocked(renderCampaignReportPdf).mockResolvedValue(Buffer.from('fresh'));
});

describe('GET …/report', () => {
  it('cache présent : resservi tel quel, rien n’est assemblé', async () => {
    vi.mocked(downloadArtifact).mockResolvedValue(Buffer.from('cached-pdf'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Cache')).toBe('hit');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${FILE}"`);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('cached-pdf');
    expect(downloadArtifact).toHaveBeenCalledWith(`campagnes/${ID}/${FILE}`);
    expect(assembleCampaignReport).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('cache absent : rendu, mis en cache, journalisé — une seule consultation', async () => {
    vi.mocked(downloadArtifact).mockResolvedValue(null);
    const res = await call();
    expect(res.headers.get('X-Report-Cache')).toBe('miss');
    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(assembleCampaignReport).toHaveBeenCalledWith(ID, { campaign: { id: ID } });
    expect(uploadArtifactBinary).toHaveBeenCalledTimes(1);
    expect(appendJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'campaign_report_generated',
        payload: { fileName: FILE, regenerated: false },
      }),
    );
  });

  it('consultation en échec : on refait la consultation à sa place d’origine', async () => {
    vi.mocked(downloadArtifact)
      .mockRejectedValueOnce(new Error('storage KO'))
      .mockRejectedValueOnce(new Error('storage KO'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(assembleCampaignReport).toHaveBeenCalled();
    expect(downloadArtifact).toHaveBeenCalledTimes(2);
  });

  it('régénération forcée : aucune consultation du cache', async () => {
    const res = await call('?force=1');
    expect(res.headers.get('X-Report-Cache')).toBe('regenerated');
    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it('campagne introuvable ou non clôturée : 404 sans toucher au cache', async () => {
    vi.mocked(loadReportableCampaign).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(downloadArtifact).not.toHaveBeenCalled();
  });
});
