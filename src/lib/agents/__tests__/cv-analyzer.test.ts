import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

import {
  buildCVAnalyzerSystemPrompt,
  buildCVAnalyzerUserPrompt,
  formatScoringSheetForPrompt,
} from '@/lib/agents/cv-analyzer-prompts';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
  suggestCVReportFileName,
} from '@/lib/agents/cv-report-render';
import {
  CVAnalyzerError,
  executeCVAnalyzer,
} from '@/lib/agents/server/cv-analyzer-execute';
import { chatComplete } from '@/lib/ai/provider';
import { DEFAULT_CV_THRESHOLD } from '@/types/cv-analysis';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

const chatCompleteMock = vi.mocked(chatComplete);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(content: string): FakeCompletion {
  return {
    content,
    model: 'gpt-4o',
    usage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
    costEstimate: 0.005,
    durationMs: 2500,
  };
}

const SAMPLE_RESULT = {
  candidateName: 'Jeanne Dupont',
  skills: ['SAP', 'IFRS', 'Excel'],
  experienceYears: 8,
  score: 82,
  summary: 'Profil sénior aligné avec le poste. Expérience solide en clôtures.',
  strengths: ['8 ans d\'expérience comptable', 'IFRS', 'Management junior'],
  weaknesses: ['Pas de certification DSCG'],
  aboveThreshold: true,
};

describe('executeCVAnalyzer', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
  });

  it('throws empty_cv when text is missing', async () => {
    await expect(
      executeCVAnalyzer({
        taskId: 't1',
        correlationId: 'c1',
        agentId: 'agent.cv-analyzer',
        payload: { fileName: 'cv.txt', criteria: {} },
        context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
      }),
    ).rejects.toMatchObject({ code: 'empty_cv' });
  });

  it('throws invalid_payload when fileName missing', async () => {
    await expect(
      executeCVAnalyzer({
        taskId: 't1',
        correlationId: 'c1',
        agentId: 'agent.cv-analyzer',
        payload: { cvText: 'Hello world CV content here.' },
        context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
      }),
    ).rejects.toBeInstanceOf(CVAnalyzerError);
  });

  it('returns a parsed result with the file name preserved', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(JSON.stringify(SAMPLE_RESULT)),
    );

    const out = await executeCVAnalyzer({
      taskId: 't1',
      correlationId: 'c1',
      agentId: 'agent.cv-analyzer',
      payload: {
        cvText: 'Texte CV brut',
        fileName: 'cv-jeanne.pdf',
        criteria: { jobTitle: 'Comptable senior' },
        threshold: 75,
      },
      context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
    });

    const result = out.data.result as { fileName: string; score: number; aboveThreshold: boolean };
    expect(result.fileName).toBe('cv-jeanne.pdf');
    expect(result.score).toBe(82);
    expect(result.aboveThreshold).toBe(true);
    expect(out.data.threshold).toBe(75);
  });

  it('overrides aboveThreshold to match server threshold', async () => {
    // LLM dit aboveThreshold=true mais score(60) < threshold(75) → false.
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          ...SAMPLE_RESULT,
          score: 60,
          aboveThreshold: true,
        }),
      ),
    );

    const out = await executeCVAnalyzer({
      taskId: 't1',
      correlationId: 'c1',
      agentId: 'agent.cv-analyzer',
      payload: {
        cvText: 'Texte CV brut suffisant pour passer',
        fileName: 'cv.pdf',
        criteria: {},
      },
      context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
    });

    const result = out.data.result as { aboveThreshold: boolean };
    expect(result.aboveThreshold).toBe(false);
    expect(out.data.threshold).toBe(DEFAULT_CV_THRESHOLD);
  });

  it('throws invalid_response on non-JSON LLM output', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('plain text'));
    await expect(
      executeCVAnalyzer({
        taskId: 't1',
        correlationId: 'c1',
        agentId: 'agent.cv-analyzer',
        payload: {
          cvText: 'Texte CV',
          fileName: 'cv.pdf',
          criteria: {},
        },
        context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
      }),
    ).rejects.toMatchObject({ name: 'CVAnalyzerError' });
  });
});

describe('cv-analyzer-prompts', () => {
  it('system prompt mentions threshold and structure', () => {
    const p = buildCVAnalyzerSystemPrompt(75);
    expect(p).toContain('75');
    expect(p).toContain('aboveThreshold');
    expect(p).toContain('strengths');
  });

  it('user prompt includes criteria and CV text', () => {
    const p = buildCVAnalyzerUserPrompt({
      cvText: 'CV ici',
      criteria: { jobTitle: 'Comptable', keySkills: ['IFRS', 'SAP'] },
      fileName: 'a.pdf',
    });
    expect(p).toContain('Comptable');
    expect(p).toContain('IFRS, SAP');
    expect(p).toContain('CV ici');
  });

  it('user prompt uses freeText when criteria is isolated', () => {
    const p = buildCVAnalyzerUserPrompt({
      cvText: 'CV ici',
      criteria: { freeText: 'Juger comme tu veux' },
      fileName: 'a.pdf',
    });
    expect(p).toContain('Instruction libre');
    expect(p).toContain('Juger comme tu veux');
  });

  it('system prompt switches to weighted grid mode when scoring sheet is present', () => {
    const withSheet = buildCVAnalyzerSystemPrompt(75, true);
    expect(withSheet).toContain('MODE GRILLE PONDÉRÉE');
    expect(withSheet.toLowerCase()).toContain('knockout');
    const without = buildCVAnalyzerSystemPrompt(75, false);
    expect(without).not.toContain('MODE GRILLE PONDÉRÉE');
  });

  it('formatScoringSheetForPrompt groups by level and flags knockouts', () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-200',
      isValidated: true,
      criteria: [
        buildCriterion({
          id: 'c1',
          label: 'Permis B',
          level: 'redhibitoire',
        }),
        buildCriterion({ id: 'c2', label: 'IFRS', level: 'obligatoire' }),
        buildCriterion({
          id: 'c3',
          label: 'Anglais',
          level: 'important',
        }),
      ],
    };
    const txt = formatScoringSheetForPrompt(sheet);
    expect(txt).toContain('Rédhibitoire');
    expect(txt).toContain('KNOCKOUT');
    expect(txt).toContain('Permis B');
    expect(txt).toContain('Obligatoire');
    expect(txt).toContain('IFRS');
    expect(txt).toContain('(poids');
    expect(txt).toContain('Anglais');
  });

  it('user prompt embeds the scoring sheet when provided', () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-201',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    const p = buildCVAnalyzerUserPrompt({
      cvText: 'CV',
      criteria: { jobTitle: 'Comptable', scoringSheet: sheet },
      fileName: 'cv.pdf',
    });
    expect(p).toContain('Fiche de scoring');
    expect(p).toContain('IFRS');
  });
});

describe('cv-report-render', () => {
  it('buildCVBatchSummary counts above-threshold correctly', () => {
    const summary = buildCVBatchSummary(
      [
        { ...SAMPLE_RESULT, fileName: 'a.pdf', aboveThreshold: true },
        {
          ...SAMPLE_RESULT,
          fileName: 'b.pdf',
          score: 50,
          aboveThreshold: false,
        },
      ],
      75,
    );
    expect(summary.total).toBe(2);
    expect(summary.aboveThreshold).toBe(1);
    expect(summary.threshold).toBe(75);
  });

  it('renderCVBatchMarkdown includes both retenu and à arbitrer sections', () => {
    const md = renderCVBatchMarkdown(
      buildCVBatchSummary(
        [
          { ...SAMPLE_RESULT, fileName: 'a.pdf' },
          {
            ...SAMPLE_RESULT,
            fileName: 'b.pdf',
            score: 50,
            aboveThreshold: false,
          },
        ],
        75,
      ),
      'CAMP-2026-007',
    );
    expect(md).toContain('CAMP-2026-007');
    expect(md).toContain('Retenu');
    expect(md).toContain('À arbitrer');
  });

  it('suggestCVReportFileName uses campaignId and date', () => {
    const name = suggestCVReportFileName('CAMP-2026-007');
    expect(name.startsWith('rapport-cv-CAMP-2026-007-')).toBe(true);
    expect(name.endsWith('.md')).toBe(true);
  });
});
