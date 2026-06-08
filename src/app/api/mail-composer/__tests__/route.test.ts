import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  composeCandidateMailMock,
  sendEmailMock,
  uploadArtifactMock,
  insertArtifactMetaMock,
  appendJournalEntryMock,
} = vi.hoisted(() => ({
  composeCandidateMailMock: vi.fn(),
  sendEmailMock: vi.fn(async () => ({ ok: true as const })),
  uploadArtifactMock: vi.fn(async () => ({
    bucket: 'artifacts',
    path: 'p',
    publicUrl: 'https://example.test/p',
  })),
  insertArtifactMetaMock: vi.fn(async () => {}),
  appendJournalEntryMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/agents/server/mail-composer-execute', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/server/mail-composer-execute')>()),
  composeCandidateMail: composeCandidateMailMock,
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/lib/storage/blob', () => ({ uploadArtifact: uploadArtifactMock }));
vi.mock('@/lib/db/repos/artifacts', () => ({
  insertArtifactMeta: insertArtifactMetaMock,
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: appendJournalEntryMock,
}));

import { POST } from '@/app/api/mail-composer/route';

const CANDIDATE = {
  candidateName: 'Alice Martin',
  email: 'alice@mail.com',
  phone: null,
  score: 82,
  aboveThreshold: true,
  summary: 'Profil solide en finance.',
  strengths: ['IFRS'],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

function request(body: Record<string, unknown>): Request {
  return new Request('http://test/api/mail-composer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CAL_COM_EVENT_URL;
  composeCandidateMailMock.mockResolvedValue({
    mail: { subject: 'Invitation entretien', html: '<p>Bonjour</p>' },
    metrics: { tokensUsed: 0, costEstimate: 0, durationMs: 0 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/mail-composer — gating Cal.com', () => {
  it('compose un BROUILLON d’invitation même sans Cal.com configuré', async () => {
    const res = await POST(
      request({
        artifactId: 'art_1',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'invite',
        candidate: CANDIDATE,
        draft: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; html: string };
    expect(data.status).toBe('draft');
    expect(data.html).toBe('<p>Bonjour</p>');
    expect(composeCandidateMailMock).toHaveBeenCalledTimes(1);
    // Brouillon → jamais d'envoi réel.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('REFUSE l’ENVOI réel d’une invitation sans Cal.com (503)', async () => {
    const res = await POST(
      request({
        artifactId: 'art_2',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'invite',
        candidate: CANDIDATE,
        // pas de draft → envoi réel
      }),
    );
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('cal_com_not_configured');
    // Bloqué avant toute composition ou envoi.
    expect(composeCandidateMailMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('compose un brouillon de refus sans contrôle Cal.com', async () => {
    composeCandidateMailMock.mockResolvedValueOnce({
      mail: { subject: 'Votre candidature', html: '<p>Merci</p>' },
      metrics: { tokensUsed: 0, costEstimate: 0, durationMs: 0 },
    });
    const res = await POST(
      request({
        artifactId: 'art_3',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'reject',
        candidate: { ...CANDIDATE, aboveThreshold: false, score: 40 },
        draft: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('draft');
    expect(composeCandidateMailMock).toHaveBeenCalledTimes(1);
  });
});
