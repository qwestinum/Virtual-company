/**
 * Réservation NATIVE au point de résolution unique.
 *
 * Trois invariants, et le deuxième est celui qui pourrait coûter cher : un
 * REFUS ne doit jamais émettre de lien de réservation, même quand le modèle de
 * refus contient le marqueur `[lien d'agenda]` — ce qui arrive dès qu'un DRH
 * part de son modèle d'acceptation pour écrire son refus.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import type { MailCandidate } from '@/types/mail-candidate';

const {
  getAppSettingsMock,
  getCampaignMock,
  getRecruiterMock,
  emitLinkMock,
  isNativeMock,
  canEmitMock,
} = vi.hoisted(() => ({
  getAppSettingsMock: vi.fn(),
  getCampaignMock: vi.fn(),
  getRecruiterMock: vi.fn(),
  emitLinkMock: vi.fn(),
  isNativeMock: vi.fn(),
  canEmitMock: vi.fn(),
}));

vi.mock('@/lib/db/repos/app-settings', () => ({ getAppSettings: getAppSettingsMock }));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: getCampaignMock }));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: getRecruiterMock }));
vi.mock('@/lib/scheduling-host/campaign-booking', () => ({
  emitCampaignBookingLink: emitLinkMock,
  isNativeSchedulingCampaign: isNativeMock,
  canEmitBookingLink: canEmitMock,
}));

import {
  buildInterviewMail,
  canInviteForCampaign,
} from '@/lib/agents/server/interview-mail';

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

const NATIVE_URL = 'https://orqa.test/r/AbCdEf123456';
const LEGACY_LINK = 'https://cal.com/legacy/entretien';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CAL_COM_EVENT_URL;
  getCampaignMock.mockResolvedValue({
    name: 'Recrutement Compta 2026',
    fdp: { fields: { job_title: { value: 'Comptable' } } },
    ownerUserId: 'owner-1',
  });
  getRecruiterMock.mockResolvedValue(null);
  // Modèle de REFUS piégé : il contient le marqueur de lien d'agenda.
  getAppSettingsMock.mockResolvedValue({
    interviewConfig: {
      ...DEFAULT_INTERVIEW_CONFIG,
      agendaLink: LEGACY_LINK,
      organisationName: 'Qwestinum',
      rejectionTemplate: `Bonjour [prénom], nous ne donnons pas suite. [lien d'agenda]`,
    },
  });
  isNativeMock.mockResolvedValue(true);
  emitLinkMock.mockResolvedValue(NATIVE_URL);
  canEmitMock.mockResolvedValue(true);
});

describe('flag ON — invitation', () => {
  it('émet un lien nominatif et l’injecte, sans jamais servir le lien Cal.com', async () => {
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      analysisId: 'can_imap_box-a_102',
      uid: '102',
    });

    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain(NATIVE_URL);
    expect(out.mail.html).not.toContain(LEGACY_LINK);
    expect(emitLinkMock).toHaveBeenCalledTimes(1);
    expect(emitLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'CAMP-0001',
        // La clé d'idempotence est l'ANALYSE, jamais l'uid brut.
        analysisId: 'can_imap_box-a_102',
        linkKey: 'can_imap_box-a_102',
        uid: '102',
      }),
    );
  });

  it('sans identifiant d’analyse : BLOQUÉ, et surtout aucun repli sur Cal.com', async () => {
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
    });

    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('native_link_unavailable');
    expect(emitLinkMock).not.toHaveBeenCalled();
  });

  it('référent sans disponibilités (émission impossible) : bloqué, pas de lien mort', async () => {
    emitLinkMock.mockResolvedValue(null);
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      analysisId: 'can_1',
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('native_link_unavailable');
    expect(out.mail.html).toBe('');
  });

  it('une clé de réinvitation remplace la clé d’analyse à l’émission', async () => {
    await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      analysisId: 'can_1',
      linkKey: 'can_1#r2',
    });
    expect(emitLinkMock).toHaveBeenCalledWith(
      // L'identité de la candidature reste `can_1` — c'est elle qui voyage
      // dans le contexte de la réservation.
      expect.objectContaining({ analysisId: 'can_1', linkKey: 'can_1#r2' }),
    );
  });
});

describe('VERROU — un refus ne mint jamais', () => {
  it('modèle de refus contenant [lien d’agenda] : aucune émission, aucun lien', async () => {
    const out = await buildInterviewMail({
      mode: 'reject',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      analysisId: 'can_imap_box-a_102',
      uid: '102',
    });

    expect(out.blocked).toBe(false);
    expect(emitLinkMock).not.toHaveBeenCalled();
    expect(out.mail.html).not.toContain(NATIVE_URL);
    expect(out.mail.html).not.toContain(LEGACY_LINK);
    expect(out.mail.html).not.toContain('/r/');
  });
});

describe('sonde du gate — sans effet', () => {
  it('interroge la capacité du référent, n’émet AUCUN jeton', async () => {
    expect(await canInviteForCampaign('CAMP-0001')).toBe(true);
    expect(canEmitMock).toHaveBeenCalledWith('CAMP-0001');
    expect(emitLinkMock).not.toHaveBeenCalled();
  });

  it('référent sans disponibilités ⇒ invitation impossible (gate fermé)', async () => {
    canEmitMock.mockResolvedValue(false);
    expect(await canInviteForCampaign('CAMP-0001')).toBe(false);
    expect(emitLinkMock).not.toHaveBeenCalled();
  });
});

describe('flag OFF — le chemin historique est intact', () => {
  beforeEach(() => {
    isNativeMock.mockResolvedValue(false);
  });

  it('sert le lien Cal.com et n’appelle jamais le module de réservation', async () => {
    const out = await buildInterviewMail({
      mode: 'invite',
      campaignId: 'CAMP-0001',
      jobTitle: 'Comptable',
      candidate: CANDIDATE,
      analysisId: 'can_1',
    });
    expect(out.blocked).toBe(false);
    expect(out.mail.html).toContain(LEGACY_LINK);
    expect(emitLinkMock).not.toHaveBeenCalled();
  });

  it('le gate retombe sur la présence d’un lien configuré', async () => {
    expect(await canInviteForCampaign('CAMP-0001')).toBe(true);
    getAppSettingsMock.mockResolvedValue({
      interviewConfig: { ...DEFAULT_INTERVIEW_CONFIG, agendaLink: '' },
    });
    expect(await canInviteForCampaign('CAMP-0001')).toBe(false);
    expect(canEmitMock).not.toHaveBeenCalled();
  });
});
