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

  it('detects switch dialog when DRH names a different job during isolated collection', async () => {
    // Classification (1er call) — détecte le switch.
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'new_campaign',
          confidence: 0.92,
          reasoning: 'Le DRH bascule sur un autre poste.',
          needsClarification: false,
          isDistinctNewCampaign: true,
          candidateNewJobTitle: 'Commercial',
        }),
      ),
    );

    const criteria = buildEmptyIsolatedCriteria('TASK-2026-100');
    criteria.fields.job_title = {
      ...criteria.fields.job_title!,
      value: 'Développeur Python',
      status: 'filled',
    };

    const result = await runIsolatedCriteriaTurn({
      history: [
        { role: 'user', content: 'Développeur Python' },
        { role: 'manager', content: 'Quelle séniorité ?' },
        { role: 'user', content: 'En fait je veux lancer une campagne pour un commercial' },
      ],
      criteria,
    });

    // Court-circuit : un seul call LLM (classification), pas de tour conversationnel
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.pendingSwitch).not.toBeNull();
    expect(result.pendingSwitch?.currentJobTitle).toBe('Développeur Python');
    expect(result.pendingSwitch?.currentCampaignId).toBe('TASK-2026-100');
    expect(result.response.chips?.options).toEqual([
      'Oui, nouvelle campagne',
      'Non, je continue',
    ]);
  });

  it('does NOT trigger switch when criteria.job_title is not yet filled', async () => {
    // Pas de currentJobTitle ⇒ pas de classifier, donc seul le tour normal est appelé.
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          message: 'Compris, Développeur Python. Je propose senior, 5 ans.',
          fieldExtractions: { job_title: 'Développeur Python' },
        }),
      ),
    );

    const result = await runIsolatedCriteriaTurn({
      history: [{ role: 'user', content: 'Développeur Python' }],
      criteria: buildEmptyIsolatedCriteria('TASK-2026-200'),
    });

    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.pendingSwitch).toBeNull();
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
