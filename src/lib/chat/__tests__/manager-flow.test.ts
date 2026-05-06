import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chat/api-client', () => ({
  postJobWriter: vi.fn(),
  postCVAnalyzer: vi.fn(),
  postManagerChat: vi.fn(),
  postTranscribe: vi.fn(),
}));

import {
  postCVAnalyzer,
  postJobWriter,
  type CVAnalyzerResult,
  type JobWriterResult,
} from '@/lib/chat/api-client';
import {
  consumePendingIsolatedTask,
  dispatchCVBatch,
  dispatchIsolatedCVTask,
  dispatchJobWriter,
  getPendingIsolatedTask,
} from '@/lib/chat/manager-flow';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useChatStore } from '@/stores/chat-store';
import type { CVAnalysisResult } from '@/types/cv-analysis';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';

const postJobWriterMock = vi.mocked(postJobWriter);
const postCVAnalyzerMock = vi.mocked(postCVAnalyzer);

function makeFDP(id = 'CAMP-2026-007'): FDPInProgress {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title,
    status: 'filled',
    value: 'Comptable',
  };
  fdp.fields.seniority = {
    ...fdp.fields.seniority,
    status: 'filled',
    value: 'senior',
  };
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

function fakeJobWriterResult(): JobWriterResult {
  return {
    ad: {
      title: 'Comptable senior — Paris (CDI)',
      body: '# Body content',
      tags: ['Comptabilité', 'Paris'],
    },
    markdown: '# Comptable senior — Paris (CDI)\n\nBody content',
    fileName: 'annonce-comptable-senior-paris.md',
    metrics: { durationMs: 4000, tokensUsed: 500, costEstimate: 0.01 },
  };
}

function fakeCVResult(
  fileName: string,
  score = 80,
  aboveThreshold = true,
): CVAnalyzerResult {
  const result: CVAnalysisResult = {
    fileName,
    candidateName: `Candidat ${fileName}`,
    skills: ['SAP'],
    experienceYears: 5,
    score,
    summary: 'Synthèse',
    strengths: ['Expérience'],
    weaknesses: [],
    aboveThreshold,
  };
  return {
    result,
    threshold: 75,
    metrics: { durationMs: 2500, tokensUsed: 1000, costEstimate: 0.005 },
  };
}

function makeFile(name: string, content = 'CV content for ' + name): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('manager-flow — dispatchJobWriter', () => {
  beforeEach(() => {
    postJobWriterMock.mockReset();
    postCVAnalyzerMock.mockReset();
    useChatStore.getState().reset();
    useAgentsStore.getState().resetToRegistry();
    useArtifactsStore.getState().reset();
  });

  it('posts intro, creates artifact, posts attachment + source-picker', async () => {
    postJobWriterMock.mockResolvedValueOnce(fakeJobWriterResult());
    const fdp = makeFDP('CAMP-2026-007');

    await dispatchJobWriter(fdp);

    const messages = useChatStore.getState().messages;
    // Greeting + 3 messages Manager (intro, annonce + attachement,
    // source-picker)
    expect(messages.length).toBeGreaterThanOrEqual(4);

    const introBubble = messages.find((m) =>
      m.content.includes('Job Writer'),
    );
    expect(introBubble?.role).toBe('manager');

    const attachmentBubble = messages.find((m) => m.attachment !== undefined);
    expect(attachmentBubble?.attachment?.label).toContain('Annonce');

    const sourceBubble = messages.find(
      (m) => m.block?.kind === 'source-picker',
    );
    expect(sourceBubble?.block?.kind).toBe('source-picker');

    expect(Object.keys(useArtifactsStore.getState().byId)).toHaveLength(1);
  });

  it('marks job-writer busy then idle around the call', async () => {
    let observedActiveDuringCall: string | null | undefined = undefined;
    postJobWriterMock.mockImplementation(async () => {
      observedActiveDuringCall =
        useAgentsStore.getState().activeTaskByAgent['agent.job-writer'];
      return fakeJobWriterResult();
    });
    await dispatchJobWriter(makeFDP());

    expect(observedActiveDuringCall).toBeTruthy();
    expect(
      useAgentsStore.getState().activeTaskByAgent['agent.job-writer'],
    ).toBeNull();
    expect(
      useAgentsStore.getState().agents['agent.job-writer']?.status,
    ).toBe('idle');
  });

  it('posts a clean error bubble when the API fails', async () => {
    postJobWriterMock.mockRejectedValueOnce(new Error('OpenAI down'));
    await dispatchJobWriter(makeFDP());
    const messages = useChatStore.getState().messages;
    const failure = messages.find((m) =>
      m.content.includes('OpenAI down'),
    );
    expect(failure?.role).toBe('manager');
    // Pas d'attachement ni de source-picker en cas d'échec
    expect(messages.some((m) => m.attachment !== undefined)).toBe(false);
    expect(
      messages.some((m) => m.block?.kind === 'source-picker'),
    ).toBe(false);
  });
});

describe('manager-flow — dispatchCVBatch', () => {
  beforeEach(() => {
    postJobWriterMock.mockReset();
    postCVAnalyzerMock.mockReset();
    useChatStore.getState().reset();
    useAgentsStore.getState().resetToRegistry();
    useArtifactsStore.getState().reset();
  });

  it('runs through every CV and produces a final summary block', async () => {
    postCVAnalyzerMock
      .mockResolvedValueOnce(fakeCVResult('a.pdf', 82, true))
      .mockResolvedValueOnce(fakeCVResult('b.pdf', 60, false))
      .mockResolvedValueOnce(fakeCVResult('c.pdf', 90, true));

    await dispatchCVBatch({
      files: [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')],
      criteria: { jobTitle: 'Comptable' },
      threshold: 75,
      campaignId: 'CAMP-2026-007',
    });

    expect(postCVAnalyzerMock).toHaveBeenCalledTimes(3);

    const messages = useChatStore.getState().messages;
    const summaryBubble = messages.find(
      (m) => m.block?.kind === 'cv-batch-summary',
    );
    expect(summaryBubble?.attachment?.label).toContain('Rapport');

    if (summaryBubble?.block?.kind === 'cv-batch-summary') {
      expect(summaryBubble.block.summary.total).toBe(3);
      expect(summaryBubble.block.summary.aboveThreshold).toBe(2);
    }
  });

  it('continues on per-file failure and reports it', async () => {
    postCVAnalyzerMock
      .mockResolvedValueOnce(fakeCVResult('a.pdf', 82, true))
      .mockRejectedValueOnce(new Error('PDF illisible'))
      .mockResolvedValueOnce(fakeCVResult('c.pdf', 90, true));

    await dispatchCVBatch({
      files: [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')],
      criteria: {},
      threshold: 75,
      campaignId: 'CAMP-2026-007',
    });

    const messages = useChatStore.getState().messages;
    expect(
      messages.some((m) => m.content.includes('PDF illisible')),
    ).toBe(true);
    const summaryBubble = messages.find(
      (m) => m.block?.kind === 'cv-batch-summary',
    );
    if (summaryBubble?.block?.kind === 'cv-batch-summary') {
      expect(summaryBubble.block.summary.total).toBe(2);
    }
  });

  it('marks cv-analyzer busy then idle', async () => {
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf'));
    await dispatchCVBatch({
      files: [makeFile('a.pdf')],
      criteria: {},
      threshold: 75,
      campaignId: 'CAMP-2026-007',
    });
    expect(
      useAgentsStore.getState().activeTaskByAgent['agent.cv-analyzer'],
    ).toBeNull();
    expect(
      useAgentsStore.getState().agents['agent.cv-analyzer']?.status,
    ).toBe('idle');
  });
});

describe('manager-flow — isolated CV task', () => {
  beforeEach(() => {
    postCVAnalyzerMock.mockReset();
    useChatStore.getState().reset();
    useAgentsStore.getState().resetToRegistry();
    useArtifactsStore.getState().reset();
  });

  it('queues files and asks for free-text criteria', () => {
    dispatchIsolatedCVTask([makeFile('cv1.pdf'), makeFile('cv2.pdf')]);
    const pending = getPendingIsolatedTask();
    expect(pending?.files).toHaveLength(2);
    expect(pending?.taskId).toMatch(/^TASK-\d{4}-\d{3}$/);

    const messages = useChatStore.getState().messages;
    const ask = messages.find((m) =>
      m.content.includes('sur quels critères'),
    );
    expect(ask?.role).toBe('manager');
  });

  it('consumes pending task when free-text instruction arrives', async () => {
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('cv1.pdf'));
    dispatchIsolatedCVTask([makeFile('cv1.pdf')]);

    const consumed = await consumePendingIsolatedTask(
      'Profil senior comptable IFRS',
    );
    expect(consumed).toBe(true);
    expect(getPendingIsolatedTask()).toBeNull();
    expect(postCVAnalyzerMock).toHaveBeenCalledTimes(1);
    const callArg = postCVAnalyzerMock.mock.calls[0]?.[0];
    expect(callArg?.criteria.freeText).toContain('IFRS');
  });

  it('returns false when nothing is pending', async () => {
    expect(await consumePendingIsolatedTask('whatever')).toBe(false);
  });
});
