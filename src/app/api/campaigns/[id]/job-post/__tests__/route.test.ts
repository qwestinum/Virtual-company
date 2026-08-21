import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/demo-job-posts', () => ({
  getJobPost: vi.fn(),
  publishJobPost: vi.fn(),
  unpublishJobPost: vi.fn(),
}));

import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  getJobPost,
  publishJobPost,
  unpublishJobPost,
} from '@/lib/db/repos/demo-job-posts';
import { DELETE, GET, PUT } from '@/app/api/campaigns/[id]/job-post/route';

const campaign = vi.mocked(getCampaign);
const publish = vi.mocked(publishJobPost);
const unpublish = vi.mocked(unpublishJobPost);
const read = vi.mocked(getJobPost);

const ID = 'CAMP-2026-511';
const params = { params: Promise.resolve({ id: ID }) };

function putRequest(body: unknown): Request {
  return new Request(`http://localhost/api/campaigns/${ID}/job-post`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = {
  title: 'Comptable général confirmé (H/F)',
  body: '## Missions\n- Tenue comptable',
  tags: ['Comptabilité', 'CDI'],
};

describe('/api/campaigns/[id]/job-post', () => {
  const prevFlag = process.env.DEMO_JOBBOARD_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEMO_JOBBOARD_ENABLED = '1';
    campaign.mockResolvedValue({
      id: ID,
      fdp: {
        campaignId: ID,
        isComplete: true,
        isValidated: true,
        fields: {
          job_title: { key: 'job_title', label: '', status: 'filled', required: true, value: 'Comptable' },
          location: { key: 'location', label: '', status: 'filled', required: true, value: ' Paris ' },
          contract_type: { key: 'contract_type', label: '', status: 'filled', required: true, value: 'CDI' },
        },
      },
    } as never);
    publish.mockImplementation(async (input) => ({
      ...input,
      isVisible: true,
      publishedAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z',
    }));
    unpublish.mockResolvedValue(null);
    read.mockResolvedValue(null);
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.DEMO_JOBBOARD_ENABLED;
    else process.env.DEMO_JOBBOARD_ENABLED = prevFlag;
  });

  it('FAIL-CLOSED : sans le flag, les trois verbes rendent 404 et n’écrivent rien', async () => {
    delete process.env.DEMO_JOBBOARD_ENABLED;
    expect((await GET(new Request('http://x'), params)).status).toBe(404);
    expect((await PUT(putRequest(VALID), params)).status).toBe(404);
    expect((await DELETE(new Request('http://x'), params)).status).toBe(404);
    expect(publish).not.toHaveBeenCalled();
    expect(unpublish).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('PUBLIE le texte REÇU tel quel — le générateur n’est jamais rappelé', async () => {
    const edited = { ...VALID, body: 'Texte corrigé à la main devant le prospect.' };
    const res = await PUT(putRequest(edited), params);
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: ID, body: edited.body }),
    );
    expect((await res.json()).post.isVisible).toBe(true);
  });

  it('FIGE localisation et contrat depuis la FDP au moment du snapshot', async () => {
    await PUT(putRequest(VALID), params);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Paris', contract: 'CDI' }),
    );
  });

  it('refuse une annonce vide (400) et une campagne inconnue (404)', async () => {
    expect((await PUT(putRequest({ title: '', body: '' }), params)).status).toBe(400);
    campaign.mockResolvedValue(null);
    expect((await PUT(putRequest(VALID), params)).status).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it('DELETE dépublie sans effacer, et reste idempotent', async () => {
    const res = await DELETE(new Request('http://x'), params);
    expect(res.status).toBe(200);
    expect(unpublish).toHaveBeenCalledWith(ID);
    expect((await res.json()).post).toBe(null);
  });
});
