/**
 * Extraction des faits datés de la frise — le trou historique : un gris
 * REFUSÉ par un humain (`hitl_validation_sent` decision=reject) était ignoré,
 * la frise s'arrêtait à l'analyse (constat prod 31/07/2026, cas Malaka).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CandidateAnalysisDetail } from '@/types/reporting';
import type { JournalEntry } from '@/lib/db/repos/journal';

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: vi.fn(),
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  getScheduledInterviewByUid: vi.fn().mockResolvedValue(null),
}));

import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { extractCandidateTimelineFacts } from '../timeline-facts';

function detail(over: Partial<CandidateAnalysisDetail> = {}): CandidateAnalysisDetail {
  return {
    uid: '152',
    campaignId: 'CAMP-2026-200',
    receivedAt: '2026-07-30T22:27:06.667Z',
    createdAt: '2026-07-30T22:27:06.667Z',
    computedAt: '2026-07-31T10:00:00.000Z',
    source: 'email',
    fileName: 'Cv_Malaka.pdf',
    totalScore: 39,
    status: 'rejected',
    decidedByUser: { userId: 'u1', email: 'manuela.chotoklieva@biagroupe.fr' },
    fromVivier: false,
    dismissedAt: null,
    dismissalReason: null,
    application: {
      scoringResult: { criteriaVersion: 'v1' },
      narration: { justification: 'j' },
    },
    ...over,
  } as unknown as CandidateAnalysisDetail;
}

function entry(
  action: string,
  payload: Record<string, unknown>,
  createdAt = '2026-07-31T07:19:05.000Z',
): JournalEntry {
  return {
    id: 1,
    campaignId: 'CAMP-2026-200',
    actor: 'user',
    action,
    payload,
    createdAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listJournalEntriesByActions).mockResolvedValue([]);
});

describe('extractCandidateTimelineFacts — refus/acceptation HITL', () => {
  it('hitl reject + mailSent → rejectionSentAt posé, via validation, décideur exposé', async () => {
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      entry('hitl_validation_sent', {
        uid: '152',
        decision: 'reject',
        mailSent: true,
        mailStatus: 'sent',
      }),
    ]);
    const facts = await extractCandidateTimelineFacts(detail(), null);
    expect(facts.rejectionSentAt).toBe('2026-07-31T07:19:05.000Z');
    expect(facts.rejectionViaValidation).toBe(true);
    expect(facts.decidedByUserEmail).toBe('manuela.chotoklieva@biagroupe.fr');
  });

  it('hitl reject SANS mail parti (mailSent:false) → aucun fait « envoyé »', async () => {
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      entry('hitl_validation_sent', {
        uid: '152',
        decision: 'reject',
        mailSent: false,
        mailStatus: 'send_failed',
      }),
    ]);
    const facts = await extractCandidateTimelineFacts(detail(), null);
    expect(facts.rejectionSentAt).toBeNull();
    expect(facts.rejectionViaValidation).toBe(false);
  });

  it('hitl accept + mailSent → « Candidat validé » ET « Invitation envoyée »', async () => {
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      entry('hitl_validation_sent', {
        uid: '152',
        decision: 'accept',
        mailSent: true,
        mailStatus: 'sent',
      }),
    ]);
    const facts = await extractCandidateTimelineFacts(detail(), null);
    expect(facts.validatedAt).toBe('2026-07-31T07:19:05.000Z');
    expect(facts.invitationSentAt).toBe('2026-07-31T07:19:05.000Z');
  });

  it('ignore les entrées d’un autre uid', async () => {
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      entry('hitl_validation_sent', {
        uid: '999',
        decision: 'reject',
        mailSent: true,
      }),
    ]);
    const facts = await extractCandidateTimelineFacts(detail(), null);
    expect(facts.rejectionSentAt).toBeNull();
  });

  it('refus AUTO (imap_outreach_mail sent) inchangé — sans marqueur validation', async () => {
    vi.mocked(listJournalEntriesByActions).mockResolvedValue([
      entry('imap_outreach_mail', { uid: '152', mode: 'reject', status: 'sent' }),
    ]);
    const facts = await extractCandidateTimelineFacts(detail(), null);
    expect(facts.rejectionSentAt).toBe('2026-07-31T07:19:05.000Z');
    expect(facts.rejectionViaValidation).toBe(false);
  });
});
