import { describe, expect, it } from 'vitest';

import { rowToDetail, rowToSummary } from '@/lib/db/repos/candidate-analyses';
import type { CandidateAnalysisRow } from '@/lib/db/types';

const ROW: CandidateAnalysisRow = {
  id: 'can_42',
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
  created_at: '2026-06-06T09:05:01.000Z',
};

describe('rowToSummary', () => {
  it('mappe une row en résumé (snake_case → camelCase, sans application)', () => {
    const s = rowToSummary(ROW);
    expect(s).toEqual({
      id: 'can_42',
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
    });
    expect('application' in s).toBe(false);
  });

  it('préserve les nullables (campagne / email)', () => {
    const s = rowToSummary({ ...ROW, campaign_id: null, candidate_email: null });
    expect(s.campaignId).toBeNull();
    expect(s.candidateEmail).toBeNull();
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
