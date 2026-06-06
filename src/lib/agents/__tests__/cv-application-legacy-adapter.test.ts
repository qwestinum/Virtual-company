import { describe, it, expect } from 'vitest';

import { toLegacyCVResult } from '@/lib/agents/cv-application-legacy-adapter';
import { CVAnalysisResultSchema, type CVApplication } from '@/types/cv-analysis';

function application(overrides: Partial<{
  status: 'accepted' | 'rejected';
  totalScore: number;
}> = {}): CVApplication {
  return {
    candidate: {
      fullName: 'Marie Lefèvre',
      email: 'marie@mail.com',
      phone: '+33 6 11 22 33 44',
      detectedLanguage: 'fr',
      fileName: 'cv-marie.pdf',
      source: 'manual',
      receivedAt: '2026-06-06T10:00:00.000Z',
      rightToWork: true,
      location: 'Paris',
      photoPresent: false,
    },
    scoringResult: {
      totalScore: overrides.totalScore ?? 88,
      status: overrides.status ?? 'accepted',
      breakdown: [
        {
          criterionId: 's1',
          criterionLabel: 'IFRS',
          criticityLevel: 'critique',
          weight: 8,
          behavior: 'SOFT_WEIGHTED',
          llmDecision: 'satisfait',
          llmJustification: 'IFRS démontré.',
          llmCVQuote: 'IFRS',
          contribution: 40,
        },
      ],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-06T10:00:00.000Z',
    },
    narration: {
      summary: 'Profil solide.',
      strengths: ['Maîtrise IFRS'],
      weaknesses: [],
      justification: 'Au-dessus du seuil.',
    },
  };
}

describe('toLegacyCVResult', () => {
  it('projette CVApplication → CVAnalysisResult valide', () => {
    const legacy = toLegacyCVResult(application());
    expect(CVAnalysisResultSchema.safeParse(legacy).success).toBe(true);
  });

  it('mappe candidat, score et narration sur les anciens champs', () => {
    const legacy = toLegacyCVResult(application({ totalScore: 88, status: 'accepted' }));
    expect(legacy.candidateName).toBe('Marie Lefèvre');
    expect(legacy.email).toBe('marie@mail.com');
    expect(legacy.phone).toBe('+33 6 11 22 33 44');
    expect(legacy.fileName).toBe('cv-marie.pdf');
    expect(legacy.score).toBe(88);
    expect(legacy.summary).toBe('Profil solide.');
    expect(legacy.strengths).toEqual(['Maîtrise IFRS']);
    expect(legacy.justification).toBe('Au-dessus du seuil.');
  });

  it('aboveThreshold = (statut accepted)', () => {
    expect(toLegacyCVResult(application({ status: 'accepted' })).aboveThreshold).toBe(true);
    // Knockouté : score élevé conservé MAIS statut rejected → aboveThreshold false.
    const knocked = toLegacyCVResult(application({ status: 'rejected', totalScore: 88 }));
    expect(knocked.aboveThreshold).toBe(false);
    expect(knocked.score).toBe(88); // score réel conservé
  });

  it('skills/experienceYears vidés (transitoire — remplacés par le breakdown en 6b)', () => {
    const legacy = toLegacyCVResult(application());
    expect(legacy.skills).toEqual([]);
    expect(legacy.experienceYears).toBe(0);
  });
});
