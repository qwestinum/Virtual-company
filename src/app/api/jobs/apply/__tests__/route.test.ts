import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/demo-job-posts', () => ({
  getVisibleJobPost: vi.fn(),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db/repos/app-settings', () => ({ getAppSettings: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/campaign/reception-address', () => ({
  resolveCampaignReceptionAddress: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/jobboard/rate-limit', () => ({
  clientIp: () => '203.0.113.7',
  consumeApplyQuota: vi.fn(),
}));

import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getVisibleJobPost } from '@/lib/db/repos/demo-job-posts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { sendEmail } from '@/lib/email/client';
import { consumeApplyQuota } from '@/lib/jobboard/rate-limit';
import { POST } from '@/app/api/jobs/apply/route';

const visible = vi.mocked(getVisibleJobPost);
const campaign = vi.mocked(getCampaign);
const address = vi.mocked(resolveCampaignReceptionAddress);
const send = vi.mocked(sendEmail);
const quota = vi.mocked(consumeApplyQuota);
const journal = vi.mocked(appendJournalEntry);

const CAMPAIGN_ID = 'CAMP-2026-511';

function pdf(name = 'cv-jean.pdf', bytes = 2048): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

function applyRequest(overrides: Record<string, string | File> = {}): Request {
  const form = new FormData();
  form.append('campaignId', CAMPAIGN_ID);
  form.append('fullName', 'Jean Dupont');
  form.append('email', 'jean.dupont@example.com');
  form.append('phone', '0612345678');
  form.append('cv', pdf());
  for (const [k, v] of Object.entries(overrides)) form.set(k, v);
  return new Request('http://localhost/api/jobs/apply', { method: 'POST', body: form });
}

describe('POST /api/jobs/apply', () => {
  const prevFlag = process.env.DEMO_JOBBOARD_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEMO_JOBBOARD_ENABLED = '1';
    quota.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    visible.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      title: 'Comptable général confirmé (H/F)',
      body: 'Annonce.',
      tags: [],
      location: 'Paris',
      contract: 'CDI',
      isVisible: true,
      publishedAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z',
    });
    campaign.mockResolvedValue({
      id: CAMPAIGN_ID,
      status: 'active',
      scoringSheet: { isValidated: true },
    } as never);
    address.mockResolvedValue('recrutement@demo-orqa.fr');
    send.mockResolvedValue({ ok: true, messageId: 'msg_1' });
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.DEMO_JOBBOARD_ENABLED;
    else process.env.DEMO_JOBBOARD_ENABLED = prevFlag;
  });

  it('FAIL-CLOSED : sans le flag → 404, et RIEN n’est envoyé', async () => {
    delete process.env.DEMO_JOBBOARD_ENABLED;
    const res = await POST(applyRequest());
    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });

  it('un flag mal posé ne suffit pas (fail-closed strict)', async () => {
    for (const value of ['', '0', 'true', 'yes']) {
      process.env.DEMO_JOBBOARD_ENABLED = value;
      expect((await POST(applyRequest())).status).toBe(404);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('envoie un mail à la boîte de la campagne, sujet portant la référence', async () => {
    const res = await POST(applyRequest());
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('recrutement@demo-orqa.fr');
    expect(mail.subject).toContain(CAMPAIGN_ID);
    expect(mail.replyTo).toBe('jean.dupont@example.com');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0]).toMatchObject({
      filename: 'cv-jean.pdf',
      // Sans type explicite, la porte MIME du poller ne tiendrait qu'au nom.
      contentType: 'application/pdf',
    });
  });

  it('trace l’envoi avec l’état de la campagne (diagnostic d’un CV « jamais arrivé »)', async () => {
    await POST(applyRequest());
    const entry = journal.mock.calls[0][0];
    expect(entry.action).toBe('demo_jobboard_application_sent');
    expect(entry.payload).toMatchObject({
      campaignStatus: 'active',
      scoringSheetValidated: true,
      recipient: 'recrutement@demo-orqa.fr',
    });
  });

  it('le débit est consommé AVANT la lecture du corps multipart', async () => {
    quota.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(applyRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(visible).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('offre dépubliée → 404, aucun envoi', async () => {
    visible.mockResolvedValue(null);
    const res = await POST(applyRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('offer_not_found');
    expect(send).not.toHaveBeenCalled();
  });

  it('aucune boîte de réception → 503 explicite, tracé, jamais un faux succès', async () => {
    address.mockResolvedValue(null);
    const res = await POST(applyRequest());
    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect(journal.mock.calls[0][0].action).toBe('demo_jobboard_application_failed');
  });

  it('fichier refusé (format, taille) → 422 avant tout accès base', async () => {
    const res = await POST(
      applyRequest({ cv: new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' }) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('unsupported_format');
    expect(visible).not.toHaveBeenCalled();
  });

  it('échec du transport → 502 et trace, jamais « candidature envoyée »', async () => {
    send.mockResolvedValue({ ok: false, messageId: null, error: 'domain_blocked' });
    const res = await POST(applyRequest());
    expect(res.status).toBe(502);
    expect(journal.mock.calls[0][0].payload).toMatchObject({ reason: 'domain_blocked' });
  });
});
