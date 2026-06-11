import { describe, expect, it } from 'vitest';

import { renderCandidateAuditPdf } from '@/lib/reporting/candidate-audit-pdf';
import type { CandidateAnalysisDetail } from '@/types/reporting';
import type { CandidateJourney } from '@/lib/reporting/candidate-journey';
import type { CriterionDecision } from '@/types/scoring';

function dec(p: Partial<CriterionDecision>): CriterionDecision {
  return {
    criterionId: 'c',
    criterionLabel: 'Critère',
    criticityLevel: 'important',
    weight: 5,
    behavior: 'SOFT_WEIGHTED',
    llmDecision: 'satisfait',
    llmJustification: 'ok',
    llmCVQuote: '',
    contribution: 10,
    ...p,
  };
}

const JOURNEY: CandidateJourney = {
  screening: 'retenu',
  validation: 'en_attente',
  interview: 'na',
  final: 'na',
  humanIntervention: false,
};

const DETAIL: CandidateAnalysisDetail & { journey: CandidateJourney } = {
  id: 'can_1',
  uid: 'can_1',
  campaignId: 'CAMP-1',
  candidateName: 'Jean Test',
  candidateEmail: 'jean@mail.com',
  fileName: 'cv.pdf',
  source: 'email',
  receivedAt: '2026-06-06T09:00:00.000Z',
  totalScore: 80,
  status: 'accepted',
  computedAt: '2026-06-06T09:05:00.000Z',
  createdAt: '2026-06-06T09:05:01.000Z',
  hitlConfig: { rejectionMail: true, acceptanceMail: true },
  journey: JOURNEY,
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
      totalScore: 80,
      status: 'accepted',
      breakdown: [
        dec({ criterionId: 'a', criterionLabel: 'React', verificationMethodUsed: 'keywords_exact', matchedKeywords: ['React'] }),
        dec({ criterionId: 'b', criterionLabel: 'Management', verificationMethodUsed: 'hybrid_keywords_llm', matchedKeywords: [] }),
        dec({ criterionId: 'c', criterionLabel: 'Relationnel', verificationMethodUsed: 'llm_with_quote' }),
      ],
      hardFailures: [],
      criteriaVersion: 'unversioned',
      computedAt: '2026-06-06T09:05:00.000Z',
    },
    narration: { summary: 'Profil solide.', strengths: [], weaknesses: [], justification: 'OK.' },
  },
};

describe('renderCandidateAuditPdf — méthodes de vérification (Phase 4)', () => {
  it('génère un PDF non vide avec des critères de chaque méthode', async () => {
    const pdf = await renderCandidateAuditPdf({
      detail: DETAIL,
      generatedAtIso: '2026-06-11T10:00:00.000Z',
      campaignLabel: 'Campagne CAMP-1',
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
