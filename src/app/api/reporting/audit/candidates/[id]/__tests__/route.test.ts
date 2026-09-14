/**
 * Détail d'audit d'une candidature : une seule lecture du journal et une seule
 * de la file HITL pour le parcours, la frise et l'étape — et les mêmes statuts
 * qu'en séquence (404, échec vivier ⇒ 500).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listJournalEntriesByActions = vi.fn();
const listPendingValidations = vi.fn();
const getCandidateAnalysis = vi.fn();
const findContactedProposalByEmail = vi.fn();

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: (...a: unknown[]) => listJournalEntriesByActions(...a),
}));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  listPendingValidations: () => listPendingValidations(),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  getCandidateAnalysis: (id: string) => getCandidateAnalysis(id),
  listAllCandidateAnalyses: vi.fn(async () => []),
  countCandidateAnalyses: vi.fn(async () => 0),
}));
vi.mock('@/lib/db/repos/vivier-preselection', () => ({
  findContactedProposalByEmail: (...a: unknown[]) => findContactedProposalByEmail(...a),
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  listScheduledInterviewUids: vi.fn(async () => new Set<string>()),
  getScheduledInterviewByUid: vi.fn(async () => null),
}));
vi.mock('@/lib/db/repos/artifacts', () => ({ getArtifactMeta: vi.fn(async () => null) }));

import { GET } from '@/app/api/reporting/audit/candidates/[id]/route';

const ANALYSIS = {
  id: 'can_imap_box_1',
  uid: 'u1',
  campaignId: 'CAMP-1',
  candidateEmail: 'malaka@example.com',
  status: 'accepted',
  decisionZone: 'auto_accept',
  decidedBy: 'auto',
  dismissedAt: null,
  dismissalReason: null,
  receivedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  computedAt: '2026-09-01T00:00:00.000Z',
  application: { scoringResult: { criteriaVersion: 'v1' }, narration: { justification: 'j' } },
};

const call = () =>
  GET(new Request('http://localhost/api/reporting/audit/candidates/x'), {
    params: Promise.resolve({ id: ANALYSIS.id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  listJournalEntriesByActions.mockResolvedValue([]);
  listPendingValidations.mockResolvedValue([]);
  getCandidateAnalysis.mockResolvedValue(ANALYSIS);
  findContactedProposalByEmail.mockResolvedValue(null);
});

describe('GET /api/reporting/audit/candidates/[id]', () => {
  it('une lecture du journal et une de la file, sur la campagne de l’analyse', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(listJournalEntriesByActions).toHaveBeenCalledTimes(1);
    expect(listJournalEntriesByActions.mock.calls[0]?.[1]).toEqual({ campaignId: 'CAMP-1' });
    expect(listPendingValidations).toHaveBeenCalledTimes(1);
    const json = (await res.json()) as { stage: string; candidate: { journey: unknown } };
    expect(json.candidate.journey).toBeTruthy();
  });

  it('404 sans rien lire d’autre', async () => {
    getCandidateAnalysis.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(listJournalEntriesByActions).not.toHaveBeenCalled();
  });

  it('l’échec de la lecture vivier fait toujours échouer la requête', async () => {
    findContactedProposalByEmail.mockRejectedValue(new Error('vivier KO'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { message: string }).message).toBe('vivier KO');
  });

  it('un journal illisible ne fait pas échouer la requête', async () => {
    listJournalEntriesByActions.mockRejectedValue(new Error('journal KO'));
    const res = await call();
    expect(res.status).toBe(200);
  });
});
