/**
 * Ce que le dialog AFFICHE avant confirmation.
 *
 * Le bloc « ce qui a déjà été déclenché » n'est jamais vide : quand rien n'est
 * parti, il le DIT. Un bloc absent se lirait comme « pas vérifié », et c'est
 * exactement ce qu'on ne veut pas au moment de trancher.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JournalEntry } from '@/lib/db/repos/journal';
import type { CandidateAnalysisSummary } from '@/types/reporting';

const listJournalEntriesByActions = vi.fn(async (): Promise<JournalEntry[]> => []);
const bookingLinkStateForAnalysis = vi.fn(
  async (): Promise<{ hasActive: boolean; statuses: string[] } | null> => null,
);
const getScheduledInterviewByUid = vi.fn(
  async (): Promise<{ startAt: string | null; bookedAt: string | null } | null> =>
    null,
);
const interviewMarks = new Map<string, 'realized' | 'missed'>();
const validationMarks = new Map<string, 'validated' | 'rejected'>();
const stage = vi.fn(() => 'entretien_fait');

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: () => listJournalEntriesByActions(),
}));
vi.mock('@/lib/scheduling-host/campaign-booking', () => ({
  bookingLinkStateForAnalysis: () => bookingLinkStateForAnalysis(),
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  getScheduledInterviewByUid: () => getScheduledInterviewByUid(),
}));
vi.mock('@/lib/reporting/stage-signals', () => ({
  loadStageSignals: vi.fn(async () => ({
    pendingUids: new Set<string>(),
    scheduledUids: new Set<string>(),
    interviewMarks,
    interviewMarkedAt: new Map([['uid-malaka', '2026-08-21T14:32:00.000Z']]),
    validationMarks,
  })),
  stageFor: () => stage(),
}));

const analysis = {
  id: 'can_imap_box_102',
  uid: 'uid-malaka',
  campaignId: 'CAMP-2026-288',
  candidateName: 'Malaka Diarra',
  candidateEmail: 'malaka@example.com',
  dismissalReason: null,
  dismissedAt: null,
  decidedByUser: null,
  dismissedByUser: null,
} as unknown as CandidateAnalysisSummary;

async function load() {
  const { loadDecisionCorrectionContext } = await import(
    '@/lib/candidatures/correction-context'
  );
  return loadDecisionCorrectionContext(analysis);
}

beforeEach(() => {
  vi.clearAllMocks();
  interviewMarks.clear();
  validationMarks.clear();
  listJournalEntriesByActions.mockResolvedValue([]);
  bookingLinkStateForAnalysis.mockResolvedValue(null);
  getScheduledInterviewByUid.mockResolvedValue(null);
});

describe('« aucun message parti » vs « un mail est parti »', () => {
  it('un marquage d’entretien : aucun envoi, et c’est AFFIRMÉ', async () => {
    interviewMarks.set('uid-malaka', 'realized');
    stage.mockReturnValue('entretien_fait');
    const ctx = await load();
    expect(ctx.current).toEqual({ kind: 'interview', value: 'realized' });
    expect(ctx.sideEffects.length).toBeGreaterThan(0);
    expect(ctx.sideEffects[0].code).toBe('no_mail');
    expect(ctx.sideEffects[0].text).toContain('Aucun message');
    // Un marquage journalisé n'a pas d'auteur : on ne l'invente pas.
    expect(ctx.decidedBy).toBeNull();
    expect(ctx.decidedAt).toBe('2026-08-21T14:32:00.000Z');
  });

  it('un refus HITL réellement envoyé est signalé en avertissement', async () => {
    stage.mockReturnValue('non_retenu');
    listJournalEntriesByActions.mockResolvedValue([
      {
        id: 1,
        action: 'hitl_validation_sent',
        campaignId: 'CAMP-2026-288',
        actor: 'user',
        payload: {
          uid: 'uid-malaka',
          decision: 'reject',
          mailSent: true,
          mailStatus: 'sent',
        },
        createdAt: '2026-08-21T14:00:00.000Z',
      },
    ]);
    const ctx = await load();
    const mail = ctx.sideEffects.find((e) => e.code === 'mail_sent');
    expect(mail?.emphasis).toBe('warning');
    expect(mail?.text).toContain('mail de refus a été envoyé');
    expect(mail?.text).toContain('malaka@example.com');
    expect(mail?.text).toContain('ne l’annule pas');
  });

  it('une décision prise SANS envoi ne se lit pas comme un mail parti', async () => {
    stage.mockReturnValue('non_retenu');
    listJournalEntriesByActions.mockResolvedValue([
      {
        id: 2,
        action: 'hitl_mail_not_sent',
        campaignId: 'CAMP-2026-288',
        actor: 'user',
        payload: { uid: 'uid-malaka', cause: 'skipped_by_user' },
        createdAt: '2026-08-21T14:00:00.000Z',
      },
    ]);
    const ctx = await load();
    expect(ctx.sideEffects.some((e) => e.code === 'mail_sent')).toBe(false);
    const notSent = ctx.sideEffects.find((e) => e.code === 'mail_not_sent');
    expect(notSent?.text).toContain('volontairement sauté');
  });
});

describe('lien de réservation et rendez-vous', () => {
  it('régime Cal.com : l’absence d’objet lien est DITE, pas laissée vide', async () => {
    stage.mockReturnValue('invite');
    bookingLinkStateForAnalysis.mockResolvedValue(null);
    const ctx = await load();
    expect(ctx.sideEffects.some((e) => e.code === 'link_none')).toBe(true);
  });

  it('un lien actif est annoncé AVANT confirmation', async () => {
    stage.mockReturnValue('invite');
    bookingLinkStateForAnalysis.mockResolvedValue({
      hasActive: true,
      statuses: ['active'],
    });
    const ctx = await load();
    const link = ctx.sideEffects.find((e) => e.code === 'link_active');
    expect(link?.emphasis).toBe('warning');
    expect(link?.text).toContain('désactivé');
  });

  it('un rendez-vous confirmé est rappelé', async () => {
    stage.mockReturnValue('rdv_pris');
    getScheduledInterviewByUid.mockResolvedValue({
      startAt: '2026-08-25T08:00:00.000Z',
      bookedAt: null,
    });
    const ctx = await load();
    const rdv = ctx.sideEffects.find((e) => e.code === 'booking_confirmed');
    expect(rdv?.text).toContain('rendez-vous est confirmé');
    expect(rdv?.text).toContain('ne l’annule pas');
  });
});

describe('rien à corriger', () => {
  it('un dossier en attente de validation n’offre aucune option', async () => {
    stage.mockReturnValue('a_valider');
    const ctx = await load();
    expect(ctx.current).toBeNull();
    expect(ctx.options).toEqual([]);
    expect(ctx.sideEffects).toEqual([]);
  });
});
