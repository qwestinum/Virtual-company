import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

import { chatComplete } from '@/lib/ai/provider';
import { runIsolatedCriteriaTurn } from '@/lib/agents/manager-isolated';
import { buildEmptyIsolatedCriteria } from '@/types/isolated-criteria';

const chatCompleteMock = vi.mocked(chatComplete);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(content: string): FakeCompletion {
  return {
    content,
    model: 'gpt-4o',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    costEstimate: 0.001,
    durationMs: 100,
  };
}

describe('runIsolatedCriteriaTurn — backfill extractions from message', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
  });

  it('backfills seniority when message proposes it but extractions miss it', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message:
            "J'ai noté Développeur Python. Je propose : profil senior, 5 ans d'expérience.",
          fieldExtractions: { job_title: 'Développeur Python' },
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'Développeur Python' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-001'),
    });

    expect(result.response.fieldExtractions).toMatchObject({
      job_title: 'Développeur Python',
      seniority: 'senior',
      experience_years: 5,
    });
  });

  it('backfills key_skills from a slash-separated list after "compétences clés"', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message:
            "Je propose senior, 5 ans, compétences clés Python / SQL / Spark / Airflow.",
          fieldExtractions: {},
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'data engineer' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-002'),
    });

    expect(result.response.fieldExtractions?.key_skills).toEqual([
      'Python',
      'SQL',
      'Spark',
      'Airflow',
    ]);
  });

  it('does NOT override extractions explicitly provided by the LLM', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message: "Je propose : profil senior, 5 ans d'expérience.",
          fieldExtractions: { seniority: 'junior', experience_years: 2 },
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'développeur' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-003'),
    });

    expect(result.response.fieldExtractions).toMatchObject({
      seniority: 'junior',
      experience_years: 2,
    });
  });

  it('normalizes "confirme/confirmée" to canonical "confirmé"', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message: "Je propose : profil confirme, 3 ans d'expérience.",
          fieldExtractions: {},
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'analyste' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-004'),
    });

    expect(result.response.fieldExtractions?.seniority).toBe('confirmé');
  });

  it('skips skills backfill when list has fewer than 2 items', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message: 'Je propose les compétences clés : Python.',
          fieldExtractions: {},
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'dev' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-005'),
    });

    expect(result.response.fieldExtractions?.key_skills).toBeUndefined();
  });
});
