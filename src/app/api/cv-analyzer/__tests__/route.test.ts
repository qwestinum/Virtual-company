import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extractCVTextMock = vi.fn();
const analyzeCVApplicationMock = vi.fn();
const appendJournalEntryMock = vi.fn(async () => {});

vi.mock('@/lib/agents/cv-extract', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/cv-extract')>()),
  extractCVText: extractCVTextMock,
}));
vi.mock('@/lib/agents/server/cv-application-analyze', () => ({
  analyzeCVApplication: analyzeCVApplicationMock,
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: appendJournalEntryMock,
}));

import { buildCriterion, type ScoringSheet } from '@/types/scoring';
import type { CVApplication } from '@/types/cv-analysis';

function sheet(): ScoringSheet {
  return {
    campaignId: 'CAMP-9',
    isValidated: true,
    acceptanceThreshold: 75,
    criteria: [
      buildCriterion({ id: 'ko', label: 'Diplôme', level: 'redhibitoire' }),
      buildCriterion({ id: 's1', label: 'IFRS', level: 'critique', weight: 8 }),
    ],
  };
}

const APPLICATION: CVApplication = {
  candidate: {
    fullName: 'Jean Test',
    email: 'jean@mail.com',
    phone: null,
    detectedLanguage: 'fr',
    fileName: 'cv.txt',
    source: 'manual',
    receivedAt: '2026-06-06T00:00:00.000Z',
    rightToWork: null,
    location: null,
    photoPresent: false,
  },
  scoringResult: {
    totalScore: 90,
    status: 'accepted',
    breakdown: [],
    hardFailures: [],
    criteriaVersion: 'unversioned',
    computedAt: '2026-06-06T00:00:00.000Z',
  },
  narration: {
    summary: 'Profil solide.',
    strengths: ['IFRS'],
    weaknesses: [],
    justification: 'Au-dessus du seuil.',
  },
};

function request(scoringSheet?: ScoringSheet): Request {
  const form = new FormData();
  form.append(
    'cv',
    new File(['Jean Test — contenu de CV jean@mail.com'], 'cv.txt', {
      type: 'text/plain',
    }),
  );
  if (scoringSheet) {
    form.append('scoringSheet', JSON.stringify(scoringSheet));
  }
  form.append('threshold', '75');
  form.append('campaignId', 'CAMP-9');
  return new Request('http://localhost/api/cv-analyzer', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/cv-analyzer', () => {
  beforeEach(() => {
    extractCVTextMock.mockReset();
    analyzeCVApplicationMock.mockReset();
    appendJournalEntryMock.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuse l’analyse sans fiche de scoring → 422 no_scoring_sheet', async () => {
    const { POST } = await import('@/app/api/cv-analyzer/route');
    const res = await POST(request());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('no_scoring_sheet');
    // La garde court-circuite AVANT toute extraction/analyse.
    expect(extractCVTextMock).not.toHaveBeenCalled();
    expect(analyzeCVApplicationMock).not.toHaveBeenCalled();
  });

  it('chemin nominal : extrait → analyse (avec la fiche) → renvoie le CVApplication', async () => {
    extractCVTextMock.mockResolvedValue({
      fileName: 'cv.txt',
      text: 'Jean Test — contenu de CV jean@mail.com',
      mime: 'text/plain',
    });
    analyzeCVApplicationMock.mockResolvedValue({
      application: APPLICATION,
      metrics: { durationMs: 10, tokensUsed: 100, costEstimate: 0.001 },
      llmFailures: { candidate: false, verdicts: false, narration: false },
    });

    const { POST } = await import('@/app/api/cv-analyzer/route');
    const res = await POST(request(sheet()));
    expect(res.status).toBe(200);

    // La fiche + le seuil + la source sont bien passés au pipeline.
    const arg = analyzeCVApplicationMock.mock.calls[0][0];
    expect(arg.sheet.campaignId).toBe('CAMP-9');
    expect(arg.source).toBe('manual');
    expect(arg.acceptanceThreshold).toBe(75);

    // Réponse = CVApplication (nouveau modèle).
    const body = await res.json();
    expect(body.application.candidate.fullName).toBe('Jean Test');
    expect(body.application.scoringResult.totalScore).toBe(90);
    expect(body.application.scoringResult.status).toBe('accepted');
    expect(body.application.narration.summary).toBe('Profil solide.');
    // Journalisé pour le dashboard (action imap_cv_analyzed avec score).
    expect(appendJournalEntryMock).toHaveBeenCalled();
  });
});
