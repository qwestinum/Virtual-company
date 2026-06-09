import { describe, expect, it } from 'vitest';

import {
  auditCandidatFileName,
  buildCandidateHistory,
  formatFrDate,
  slugForFileName,
  sortByCriticality,
} from '@/lib/reporting/audit-display';
import type { CandidateAnalysisDetail } from '@/types/reporting';
import type { CriterionDecision } from '@/types/scoring';

const DETAIL: CandidateAnalysisDetail = {
  id: 'can_42',
  campaignId: 'CAMP-9',
  candidateName: 'Jean Müller',
  candidateEmail: 'jean@mail.com',
  fileName: 'cv.pdf',
  source: 'email',
  receivedAt: '2026-06-06T09:00:00.000Z',
  totalScore: 82,
  status: 'accepted',
  computedAt: '2026-06-06T09:05:00.000Z',
  createdAt: '2026-06-06T09:05:01.000Z',
  application: {
    candidate: {
      fullName: 'Jean Müller',
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
};

describe('slugForFileName', () => {
  it('translittère accents et caractères spéciaux', () => {
    expect(slugForFileName('Jean Müller-Éric')).toBe('jean-muller-eric');
  });
  it('replie sur « candidat » si vide', () => {
    expect(slugForFileName('***')).toBe('candidat');
  });
});

describe('auditCandidatFileName', () => {
  it('respecte la convention ORQA-audit-candidat-[nom]-[date].pdf', () => {
    expect(
      auditCandidatFileName('Jean Müller', '2026-06-09T14:32:00.000Z'),
    ).toBe('ORQA-audit-candidat-jean-muller-2026-06-09.pdf');
  });
});

describe('sortByCriticality', () => {
  it('place les critères durs en tête (rédhibitoire avant souhaitable)', () => {
    const mk = (id: string, level: CriterionDecision['criticityLevel']) =>
      ({
        criterionId: id,
        criterionLabel: id,
        criticityLevel: level,
        weight: 1,
        behavior: 'SOFT_WEIGHTED',
        llmDecision: 'satisfait',
        llmJustification: 'x',
        llmCVQuote: '',
        contribution: 0,
      }) as CriterionDecision;
    const out = sortByCriticality([
      mk('a', 'souhaitable'),
      mk('b', 'redhibitoire'),
      mk('c', 'important'),
    ]);
    expect(out.map((c) => c.criterionId)).toEqual(['b', 'c', 'a']);
  });
});

describe('buildCandidateHistory', () => {
  it('produit réception → scoring → décision', () => {
    const h = buildCandidateHistory(DETAIL);
    expect(h).toHaveLength(3);
    expect(h[0]!.label).toMatch(/Réception/);
    expect(h[1]!.label).toMatch(/Analyse/);
    expect(h[2]!.label).toMatch(/Décision/);
    expect(h[0]!.at).toBe('2026-06-06T09:00:00.000Z');
  });
});

describe('formatFrDate', () => {
  it('formate en français long', () => {
    expect(formatFrDate('2026-06-09T00:00:00.000Z')).toBe('9 juin 2026');
  });
  it('renvoie la valeur brute si date invalide', () => {
    expect(formatFrDate('pas-une-date')).toBe('pas-une-date');
  });
});
