import { describe, expect, it } from 'vitest';

import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
  suggestCVReportFileName,
} from '@/lib/agents/cv-report-render';
import type { CVApplication } from '@/types/cv-analysis';

function cvApp(opts: {
  fileName: string;
  status: 'accepted' | 'rejected';
  score: number;
  knockout?: boolean;
}): CVApplication {
  return {
    candidate: {
      fullName: 'Jeanne Dupont',
      email: 'jeanne@example.com',
      phone: null,
      detectedLanguage: 'fr',
      fileName: opts.fileName,
      source: 'manual',
      receivedAt: '2026-06-06T00:00:00.000Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore: opts.score,
      status: opts.status,
      breakdown: [
        {
          criterionId: 's1',
          criterionLabel: 'Maîtrise IFRS',
          criticityLevel: 'critique',
          weight: 8,
          behavior: 'SOFT_WEIGHTED',
          llmDecision: 'satisfait',
          llmJustification: 'IFRS démontré.',
          llmCVQuote: 'normes IFRS',
          contribution: 40,
        },
      ],
      hardFailures: opts.knockout
        ? [
            {
              criterionId: 'ko',
              criterionLabel: 'Diplôme DEC',
              criticityLevel: 'redhibitoire',
              reason: 'unsatisfied',
            },
          ]
        : [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-06T00:00:00.000Z',
    },
    narration: {
      summary: 'Profil sénior.',
      strengths: ['Maîtrise IFRS'],
      weaknesses: [],
      justification: 'Verdict factuel.',
    },
  };
}

describe('cv-report-render', () => {
  it('buildCVBatchSummary compte les acceptés', () => {
    const summary = buildCVBatchSummary(
      [
        cvApp({ fileName: 'a.pdf', status: 'accepted', score: 82 }),
        cvApp({ fileName: 'b.pdf', status: 'rejected', score: 50 }),
      ],
      16,
      90,
    );
    expect(summary.total).toBe(2);
    expect(summary.aboveThreshold).toBe(1);
    expect(summary.thresholdLow).toBe(16);
    expect(summary.thresholdHigh).toBe(90);
  });

  it('renderCVBatchMarkdown : Retenu/Écarté, évaluation par critère, (knockout) et décompo', () => {
    const md = renderCVBatchMarkdown(
      buildCVBatchSummary(
        [
          cvApp({ fileName: 'a.pdf', status: 'accepted', score: 82 }),
          cvApp({ fileName: 'b.pdf', status: 'rejected', score: 90, knockout: true }),
        ],
        16,
        90,
      ),
      'CAMP-2026-007',
    );
    expect(md).toContain('CAMP-2026-007');
    expect(md).toContain('Retenu');
    expect(md).toContain('Écarté');
    expect(md).toContain('Évaluation par critère');
    expect(md).toContain('(knockout)'); // score brut conservé + marqueur
    expect(md).toContain('Knockout critère rédhibitoire : 1');
  });

  it('suggestCVReportFileName uses campaignId and date', () => {
    const name = suggestCVReportFileName('CAMP-2026-007');
    expect(name.startsWith('rapport-cv-CAMP-2026-007-')).toBe(true);
    expect(name.endsWith('.md')).toBe(true);
  });
});
