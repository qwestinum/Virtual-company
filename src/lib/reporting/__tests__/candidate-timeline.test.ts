import { describe, expect, it } from 'vitest';

import {
  buildCandidateTimeline,
  type CandidateTimelineFacts,
} from '@/lib/reporting/candidate-timeline';

function facts(over: Partial<CandidateTimelineFacts> = {}): CandidateTimelineFacts {
  return {
    receivedAt: '2026-06-01T08:00:00.000Z',
    source: 'email',
    fileName: 'cv.pdf',
    analyzedAt: '2026-06-01T08:05:00.000Z',
    totalScore: 78,
    criteriaVersion: 'v1',
    status: 'accepted',
    decisionJustification: 'OK',
    fromVivier: false,
    vivierContactedAt: null,
    vivierAppliedAt: null,
    validatedAt: null,
    invitationSentAt: null,
    rejectionSentAt: null,
    scheduledAt: null,
    interviewRealizedAt: null,
    interviewMissedAt: null,
    finalValidatedAt: null,
    finalRejectedAt: null,
    ...over,
  };
}

describe('buildCandidateTimeline', () => {
  it('omet les faits sans date et garde réception + analyse', () => {
    const t = buildCandidateTimeline(facts());
    expect(t.map((e) => e.key)).toEqual(['received', 'analyzed']);
  });

  it('trie par date ascendante et inclut tous les faits datés (par-uid)', () => {
    const t = buildCandidateTimeline(
      facts({
        vivierContactedAt: '2026-05-30T10:00:00.000Z',
        invitationSentAt: '2026-06-01T09:00:00.000Z',
        interviewRealizedAt: '2026-06-05T10:00:00.000Z',
        finalValidatedAt: '2026-06-06T09:00:00.000Z',
        fromVivier: true,
      }),
    );
    expect(t.map((e) => e.key)).toEqual([
      'vivier_contacted', // 05-30
      'received', // 06-01 08:00
      'analyzed', // 06-01 08:05
      'invited', // 06-01 09:00
      'interview_realized', // 06-05
      'final_validated', // 06-06
    ]);
  });

  it('RÉCEPTION avant ANALYSE même si analyzedAt précède receivedAt (tri par rang)', () => {
    // Horodatages inversés (analyse « avant » réception, à la seconde près) :
    // l'ordre métier doit primer.
    const t = buildCandidateTimeline(
      facts({
        receivedAt: '2026-06-01T19:57:30.000Z',
        analyzedAt: '2026-06-01T19:57:10.000Z',
      }),
    );
    expect(t.map((e) => e.key)).toEqual(['received', 'analyzed']);
  });

  it('inclut « Candidat validé » et « RDV pris », dans l’ordre du pipeline', () => {
    const t = buildCandidateTimeline(
      facts({
        validatedAt: '2026-06-02T09:00:00.000Z',
        scheduledAt: '2026-06-03T14:00:00.000Z',
        interviewRealizedAt: '2026-06-05T10:00:00.000Z',
      }),
    );
    expect(t.map((e) => e.key)).toEqual([
      'received',
      'analyzed',
      'validated',
      'scheduled',
      'interview_realized',
    ]);
  });

  it('ignore une date sentinelle 1970 (analyse historique)', () => {
    const t = buildCandidateTimeline(facts({ analyzedAt: '1970-01-01T00:00:00.000Z' }));
    expect(t.map((e) => e.key)).toEqual(['received']);
  });

  it('porte la tonalité des issues négatives', () => {
    const t = buildCandidateTimeline(facts({ finalRejectedAt: '2026-06-07T00:00:00.000Z' }));
    const final = t.find((e) => e.key === 'final_rejected');
    expect(final?.tone).toBe('negative');
  });
});
