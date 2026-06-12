import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import type { MailCandidate } from '@/types/mail-candidate';

const { getAppSettingsMock, getCampaignMock } = vi.hoisted(() => ({
  getAppSettingsMock: vi.fn(),
  getCampaignMock: vi.fn(),
}));

vi.mock('@/lib/db/repos/app-settings', () => ({
  getAppSettings: getAppSettingsMock,
}));
vi.mock('@/lib/db/repos/campaigns', () => ({
  getCampaign: getCampaignMock,
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
  });
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
