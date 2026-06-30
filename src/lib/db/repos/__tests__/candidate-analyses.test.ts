import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return { ...actual, requireServerSupabase: vi.fn() };
});

import {
  deriveDecisionZone,
  insertCandidateAnalysis,
  rowToDetail,
  rowToSummary,
  updateCandidateAnalysisDecision,
  type CandidateAnalysisInsert,
} from '@/lib/db/repos/candidate-analyses';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { CandidateAnalysisRow } from '@/lib/db/types';
import { DEFAULT_HITL_CONFIG } from '@/types/hitl';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

const ROW: CandidateAnalysisRow = {
  id: 'can_42',
  uid: 'can_42',
  campaign_id: 'CAMP-9',
  candidate_name: 'Jean Test',
  candidate_email: 'jean@mail.com',
  file_name: 'cv.pdf',
  source: 'email',
  received_at: '2026-06-06T09:00:00.000Z',
  total_score: 82,
  status: 'accepted',
  criteria_version: 'unversioned',
  computed_at: '2026-06-06T09:05:00.000Z',
  from_vivier: false,
  vivier_candidate_id: null,
  application: {
    candidate: {
      fullName: 'Jean Test',
      email: 'jean@mail.com',
      phone: null,
      detectedLanguage: 'fr',
      fileName: 'cv.pdf',
      source: 'email',
      receivedAt: '2026-06-06T09:00:00.000Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore: 82,
      status: 'accepted',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'unversioned',
      computedAt: '2026-06-06T09:05:00.000Z',
    },
    narration: {
      summary: 'Profil solide.',
      strengths: [],
      weaknesses: [],
      justification: 'Au-dessus du seuil.',
    },
  },
  hitl_config: { rejectionMail: false, acceptanceMail: true },
  decision_zone: 'auto_accept',
  decided_by: 'auto',
  decided_by_user_id: null,
  decided_by_user_email: null,
  created_at: '2026-06-06T09:05:01.000Z',
};

describe('rowToSummary', () => {
  it('mappe une row en résumé (snake_case → camelCase, sans application)', () => {
    const s = rowToSummary(ROW);
    expect(s).toEqual({
      id: 'can_42',
      uid: 'can_42',
      campaignId: 'CAMP-9',
      candidateName: 'Jean Test',
      candidateEmail: 'jean@mail.com',
      fileName: 'cv.pdf',
      source: 'email',
      receivedAt: '2026-06-06T09:00:00.000Z',
      totalScore: 82,
      status: 'accepted',
      computedAt: '2026-06-06T09:05:00.000Z',
      createdAt: '2026-06-06T09:05:01.000Z',
      hitlConfig: { rejectionMail: false, acceptanceMail: true },
      decisionZone: 'auto_accept',
      decidedBy: 'auto',
      decidedByUser: null,
      fromVivier: false,
      vivierCandidateId: null,
    });
    expect('application' in s).toBe(false);
  });

  it('hitl_config null (row historique) retombe sur DEFAULT (ON)', () => {
    const s = rowToSummary({ ...ROW, hitl_config: null });
    expect(s.hitlConfig).toEqual(DEFAULT_HITL_CONFIG);
  });

  it('rétro-compat : colonnes décision NULL (ligne antérieure au lot 1) → null', () => {
    const s = rowToSummary({
      ...ROW,
      decision_zone: null,
      decided_by: null,
      decided_by_user_id: null,
      decided_by_user_email: null,
    });
    expect(s.decisionZone).toBeNull();
    expect(s.decidedBy).toBeNull();
    expect(s.decidedByUser).toBeNull();
  });

  it('ligne tranchée par un humain → decidedByUser (id + email snapshot)', () => {
    const s = rowToSummary({
      ...ROW,
      decided_by: 'user',
      decided_by_user_id: 'usr-uuid-1',
      decided_by_user_email: 'rh@client.fr',
    });
    expect(s.decidedBy).toBe('user');
    expect(s.decidedByUser).toEqual({
      userId: 'usr-uuid-1',
      email: 'rh@client.fr',
    });
  });

  it('préserve les nullables (campagne / email)', () => {
    const s = rowToSummary({ ...ROW, campaign_id: null, candidate_email: null });
    expect(s.campaignId).toBeNull();
    expect(s.candidateEmail).toBeNull();
  });

  it('uid null (row antérieure) retombe sur id', () => {
    const s = rowToSummary({ ...ROW, uid: null });
    expect(s.uid).toBe('can_42');
  });
});

describe('rowToDetail', () => {
  it('étend le résumé avec le CVApplication intégral', () => {
    const d = rowToDetail(ROW);
    expect(d.id).toBe('can_42');
    expect(d.application.candidate.fullName).toBe('Jean Test');
    expect(d.application.scoringResult.totalScore).toBe(82);
  });
});

describe('deriveDecisionZone (lot 1 : seuil unique)', () => {
  it('accepted → auto_accept', () => {
    expect(deriveDecisionZone('accepted')).toBe('auto_accept');
  });
  it('rejected → auto_reject', () => {
    expect(deriveDecisionZone('rejected')).toBe('auto_reject');
  });
});

describe('insertCandidateAnalysis — capture « système »', () => {
  afterEach(() => vi.restoreAllMocks());

  function captureInsert(): { insert: ReturnType<typeof vi.fn> } {
    const insert = vi.fn().mockResolvedValue({ error: null });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    } as never);
    return { insert };
  }

  function insertInput(
    over: Partial<CandidateAnalysisInsert> = {},
  ): CandidateAnalysisInsert {
    return {
      id: 'can_99',
      campaignId: 'CAMP-1',
      application: ROW.application,
      hitlConfig: DEFAULT_HITL_CONFIG,
      ...over,
    };
  }

  it('pose decision_zone dérivée du statut + decided_by=auto, identité null', async () => {
    const { insert } = captureInsert();
    await insertCandidateAnalysis(insertInput());
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0]).toMatchObject({
      decision_zone: 'auto_accept',
      decided_by: 'auto',
      decided_by_user_id: null,
      decided_by_user_email: null,
    });
  });

  it('statut rejected → decision_zone auto_reject', async () => {
    const { insert } = captureInsert();
    const rejected = {
      ...ROW.application,
      scoringResult: { ...ROW.application.scoringResult, status: 'rejected' as const },
    };
    await insertCandidateAnalysis(insertInput({ application: rejected }));
    expect(insert.mock.calls[0]![0]).toMatchObject({
      decision_zone: 'auto_reject',
      decided_by: 'auto',
    });
  });
});

describe('updateCandidateAnalysisDecision — propagation décision humaine (gris)', () => {
  afterEach(() => vi.restoreAllMocks());

  function captureUpdate(): {
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
  } {
    const eq = vi.fn();
    const is = vi.fn();
    const builder: Record<string, unknown> = {
      update: vi.fn(() => builder),
      eq: eq.mockImplementation(() => builder),
      is: is.mockImplementation(() => builder),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn(() => builder),
    } as never);
    return { update: builder.update as ReturnType<typeof vi.fn>, eq, is };
  }

  it('fige statut FINAL + decided_by=user + identité, keyé par uid + campagne', async () => {
    const { update, eq } = captureUpdate();
    await updateCandidateAnalysisDecision({
      uid: 'u-1',
      campaignId: 'CAMP-1',
      status: 'accepted',
      decidedByUser: { userId: 'usr-uuid', email: 'rh@client.fr' },
    });
    // decision_zone n'est JAMAIS touchée (reste 'gray' — audit « repêché »).
    expect(update).toHaveBeenCalledWith({
      status: 'accepted',
      decided_by: 'user',
      decided_by_user_id: 'usr-uuid',
      decided_by_user_email: 'rh@client.fr',
    });
    expect(eq).toHaveBeenCalledWith('uid', 'u-1');
    expect(eq).toHaveBeenCalledWith('campaign_id', 'CAMP-1');
  });

  it('campagne null (TASK/hors campagne) → filtre is null + identité null', async () => {
    const { update, is } = captureUpdate();
    await updateCandidateAnalysisDecision({
      uid: 'u-2',
      campaignId: null,
      status: 'rejected',
      decidedByUser: null,
    });
    expect(update).toHaveBeenCalledWith({
      status: 'rejected',
      decided_by: 'user',
      decided_by_user_id: null,
      decided_by_user_email: null,
    });
    expect(is).toHaveBeenCalledWith('campaign_id', null);
  });
});
