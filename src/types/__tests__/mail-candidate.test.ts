import { describe, it, expect } from 'vitest';

import {
  MailCandidateSchema,
  cvApplicationToMailCandidate,
} from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

function application(
  status: 'accepted' | 'rejected',
  totalScore = 82,
): CVApplication {
  return {
    candidate: {
      fullName: 'Marie Lefèvre',
      email: 'marie@mail.com',
      phone: '+33 6 00 00 00 00',
      detectedLanguage: 'fr',
      fileName: 'cv.pdf',
      source: 'manual',
      receivedAt: '2026-06-06T00:00:00.000Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore,
      status,
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-06T00:00:00.000Z',
    },
    narration: {
      summary: 'Profil solide.',
      strengths: ['IFRS', 'Anglais'],
      weaknesses: ['Ancienneté'],
      justification: 'Au-dessus du seuil.',
    },
  };
}

describe('cvApplicationToMailCandidate', () => {
  it('projette les 9 champs depuis candidate / scoringResult / narration', () => {
    const m = cvApplicationToMailCandidate(application('accepted', 82));
    expect(m).toEqual({
      candidateName: 'Marie Lefèvre',
      email: 'marie@mail.com',
      phone: '+33 6 00 00 00 00',
      score: 82,
      aboveThreshold: true,
      summary: 'Profil solide.',
      strengths: ['IFRS', 'Anglais'],
      weaknesses: ['Ancienneté'],
      justification: 'Au-dessus du seuil.',
    });
    expect(MailCandidateSchema.safeParse(m).success).toBe(true);
  });

  it('aboveThreshold = (statut accepted), score conservé même si rejected', () => {
    const knocked = cvApplicationToMailCandidate(application('rejected', 88));
    expect(knocked.aboveThreshold).toBe(false);
    expect(knocked.score).toBe(88);
  });
});
