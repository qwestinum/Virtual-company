import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildInterviewMailMock,
  sendEmailMock,
  uploadArtifactMock,
  insertArtifactMetaMock,
  appendJournalEntryMock,
} = vi.hoisted(() => ({
  buildInterviewMailMock: vi.fn(),
  sendEmailMock: vi.fn(async () => ({
    ok: true as const,
    messageId: 'rs_msg_abc123',
  })),
  uploadArtifactMock: vi.fn(async () => ({
    bucket: 'artifacts',
    path: 'p',
    publicUrl: 'https://example.test/p',
  })),
  insertArtifactMetaMock: vi.fn(async () => {}),
  appendJournalEntryMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/agents/server/interview-mail', () => ({
  buildInterviewMail: buildInterviewMailMock,
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
  buildInterviewMailMock.mockResolvedValue({
    blocked: false,
    mail: { subject: 'Votre candidature retenue', html: '<p>Bonjour</p>' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/mail-composer — gating lien d’agenda', () => {
  it('compose un BROUILLON d’invitation même sans lien d’agenda', async () => {
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
    expect(buildInterviewMailMock).toHaveBeenCalledTimes(1);
    expect(buildInterviewMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'invite', draft: true }),
    );
    // Brouillon → jamais d'envoi réel.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('REFUSE l’ENVOI réel d’une invitation sans lien d’agenda (503)', async () => {
    buildInterviewMailMock.mockResolvedValueOnce({
      blocked: true,
      mail: { subject: '', html: '' },
    });
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
    expect(data.error).toBe('agenda_link_not_configured');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('envoie l’invitation quand le lien d’agenda est configuré', async () => {
    const res = await POST(
      request({
        artifactId: 'art_3',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'invite',
        candidate: CANDIDATE,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('sent');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('compose un refus sans contrôle de lien d’agenda', async () => {
    const res = await POST(
      request({
        artifactId: 'art_4',
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
    expect(buildInterviewMailMock).toHaveBeenCalledTimes(1);
  });

  it('PREVIEW : recompose depuis le template sans envoyer ni persister', async () => {
    buildInterviewMailMock.mockResolvedValueOnce({
      blocked: false,
      mail: { subject: 'Depuis le modèle', html: '<p>Modèle</p>' },
    });
    const res = await POST(
      request({
        artifactId: 'preview',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'invite',
        candidate: CANDIDATE,
        preview: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      subject: string;
      html: string;
    };
    expect(data.status).toBe('preview');
    expect(data.subject).toBe('Depuis le modèle');
    expect(data.html).toBe('<p>Modèle</p>');
    // Recompose en mode brouillon (jamais bloquant) ; aucun effet de bord.
    expect(buildInterviewMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'invite', draft: true }),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(uploadArtifactMock).not.toHaveBeenCalled();
    expect(insertArtifactMetaMock).not.toHaveBeenCalled();
  });

  it('envoi AUTO : persiste le message-id Resend (réponse + journal imap_outreach_mail)', async () => {
    const res = await POST(
      request({
        artifactId: 'art_obs',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'reject',
        candidate: { ...CANDIDATE, aboveThreshold: false, score: 40 },
        uid: 'task_42', // envoi AUTO (hors HITL) → journalise imap_outreach_mail
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      providerMessageId: string | null;
    };
    expect(data.status).toBe('sent');
    // 1. La réponse porte le message-id (threading HITL + UI).
    expect(data.providerMessageId).toBe('rs_msg_abc123');
    // 2. Le journal `imap_outreach_mail` le persiste (clé pour /api/email/status).
    const calls = appendJournalEntryMock.mock.calls as unknown as Array<
      [{ action: string; payload: { providerMessageId: string | null } }]
    >;
    const outreachCall = calls.find((c) => c[0].action === 'imap_outreach_mail');
    expect(outreachCall).toBeDefined();
    expect(outreachCall![0].payload.providerMessageId).toBe('rs_msg_abc123');
  });

  it('override HITL (mail édité) : envoyé tel quel sans recomposer', async () => {
    const res = await POST(
      request({
        artifactId: 'art_5',
        campaignId: 'CAMP-2026-001',
        jobTitle: 'Comptable',
        mode: 'invite',
        candidate: CANDIDATE,
        mail: { subject: 'Édité', html: '<p>Édité</p>' },
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; subject: string };
    expect(data.status).toBe('sent');
    expect(data.subject).toBe('Édité');
    // L'override court-circuite le rendu.
    expect(buildInterviewMailMock).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
