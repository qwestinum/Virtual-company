import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import type { MailCandidate } from '@/types/mail-candidate';

const { getAppSettingsMock, getCampaignMock, getRecruiterMock } = vi.hoisted(() => ({
  getAppSettingsMock: vi.fn(),
  getCampaignMock: vi.fn(),
  getRecruiterMock: vi.fn(),
}));

vi.mock('@/lib/db/repos/app-settings', () => ({
  getAppSettings: getAppSettingsMock,
}));
vi.mock('@/lib/db/repos/campaigns', () => ({
  getCampaign: getCampaignMock,
}));
vi.mock('@/lib/db/repos/recruiters', () => ({
  getRecruiter: getRecruiterMock,
}));

import { buildInterviewMail } from '@/lib/agents/server/interview-mail';

const CANDIDATE: MailCandidate = {
  candidateName: 'Alice Martin',
  email: 'alice@mail.com',
  phone: null,
  score: 82,
  aboveThreshold: true,
  summary: 'Profil solide.',
  strengths: ['IFRS'],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

function settingsWith(agendaLink: string) {
  return {
    interviewConfig: {
      ...DEFAULT_INTERVIEW_CONFIG,
      agendaLink,
      organisationName: 'Qwestinum',
      recruiterName: 'Camille Roux',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CAL_COM_EVENT_URL;
  getCampaignMock.mockResolvedValue({
    name: 'Recrutement Compta 2026',
    fdp: { fields: { job_title: { value: 'Comptable' } } },
    ownerUserId: null,
  });
  getRecruiterMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildInterviewMail — acceptation', () => {
  it('rend le message avec le lien d’agenda quand il est configuré', async () => {
    getAppSettingsMock.mockResolvedValue(
      settingsWith('https://cal.com/qw/entretien'),
    );
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-2026-001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('Bonjour Alice');
    expect(out.mail.html).toContain(
      '<a href="https://cal.com/qw/entretien">',
    );
    expect(out.mail.subject).toContain('Comptable');
  });

  it('BLOQUE un envoi réel d’acceptation sans lien d’agenda', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith(''));
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-2026-001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(true);
  });

  it('compose un BROUILLON sans lien (placeholder visible)', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith(''));
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-2026-001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      draft: true,
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('à configurer');
  });

  it('replie sur CAL_COM_EVENT_URL si le réglage est vide', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith(''));
    process.env.CAL_COM_EVENT_URL = 'https://cal.com/env/slot';
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-2026-001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('https://cal.com/env/slot');
  });
});

describe('buildInterviewMail — refus', () => {
  it('n’est jamais bloqué et ne contient pas de lien d’agenda', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith(''));
    const out = await buildInterviewMail({
      mode: 'reject',
      campaignId: 'CAMP-2026-001',
      jobTitle: 'Comptable',
      candidate: { ...CANDIDATE, aboveThreshold: false, score: 40 },
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('Bonjour Alice');
    expect(out.mail.html).not.toContain('cal.com');
  });
});

describe('résolution d’agenda PAR CAMPAGNE (multi-utilisateur)', () => {
  const OWNER = '11111111-2222-3333-4444-555555555555';
  function campaignOwnedBy(ownerUserId: string | null) {
    getCampaignMock.mockResolvedValue({
      name: 'Recrutement Compta 2026',
      fdp: { fields: { job_title: { value: 'Comptable' } } },
      ownerUserId,
    });
  }

  it('référent ACTIF avec lien perso → SON lien prime sur le global', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith('https://cal.com/global/entretien'));
    campaignOwnedBy(OWNER);
    getRecruiterMock.mockResolvedValue({
      id: OWNER,
      isActive: true,
      calcomLink: 'https://cal.com/jane/entretien',
    });
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-1',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('https://cal.com/jane/entretien');
    expect(out.mail.html).not.toContain('https://cal.com/global/entretien');
  });

  it('référent sans lien → FALLBACK global explicite', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith('https://cal.com/global/entretien'));
    campaignOwnedBy(OWNER);
    getRecruiterMock.mockResolvedValue({ id: OWNER, isActive: true, calcomLink: null });
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-1',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.mail.html).toContain('https://cal.com/global/entretien');
  });

  it('référent DÉSACTIVÉ → fallback global (jamais l’agenda d’un parti)', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith('https://cal.com/global/entretien'));
    campaignOwnedBy(OWNER);
    getRecruiterMock.mockResolvedValue({
      id: OWNER,
      isActive: false,
      calcomLink: 'https://cal.com/parti/entretien',
    });
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-1',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.mail.html).toContain('https://cal.com/global/entretien');
    expect(out.mail.html).not.toContain('https://cal.com/parti/entretien');
  });

  it('sans référent ni lien global ni env → invitation réelle BLOQUÉE (gate inchangé)', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith(''));
    campaignOwnedBy(null);
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-1',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(true);
  });

  it('lookup recruteur en échec → fail-soft sur le global (rien ne casse)', async () => {
    getAppSettingsMock.mockResolvedValue(settingsWith('https://cal.com/global/entretien'));
    campaignOwnedBy(OWNER);
    getRecruiterMock.mockRejectedValue(new Error('db down'));
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-1',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain('https://cal.com/global/entretien');
  });
});
