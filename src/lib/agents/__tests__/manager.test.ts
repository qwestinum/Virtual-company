import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

vi.mock('@/lib/storage/job-descriptions', () => ({
  searchExistingJobDescriptions: vi.fn(async () => []),
}));

import { chatComplete } from '@/lib/ai/provider';
import {
  CLARIFICATION_THRESHOLD,
  ManagerError,
  MANAGER_AGENT_ID,
  generateCampaignId,
  runManagerTurn,
  type ConversationTurn,
} from '@/lib/agents/manager';
import {
  buildConversationalPrompt,
  buildIntentClassificationPrompt,
} from '@/lib/agents/manager-prompts';
import { searchExistingJobDescriptions } from '@/lib/storage/job-descriptions';
import { buildEmptyFDP } from '@/types/field-collection';

const chatCompleteMock = vi.mocked(chatComplete);
const searchMock = vi.mocked(searchExistingJobDescriptions);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(
  content: string,
  overrides: Partial<FakeCompletion> = {},
): FakeCompletion {
  return {
    content,
    model: 'gpt-4o-mini',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    costEstimate: 0.001,
    durationMs: 100,
    ...overrides,
  };
}

const VALID_INTENT = JSON.stringify({
  intent: 'new_campaign',
  confidence: 0.92,
  reasoning: 'Le DRH demande explicitement un recrutement.',
  needsClarification: false,
});

const VALID_RESPONSE = JSON.stringify({
  message: "Je m'en occupe. Quelle est la séniorité visée ?",
  chips: { placement: 'below_bubble', options: ['junior', 'confirmé', 'senior'] },
  fieldExtractions: { job_title: 'Comptable senior' },
});

const SIMPLE_HISTORY: ConversationTurn[] = [
  { role: 'user', content: 'Je veux recruter un comptable senior à Paris.' },
];

describe('manager — constants and helpers', () => {
  it('exports MANAGER_AGENT_ID and CLARIFICATION_THRESHOLD', () => {
    expect(MANAGER_AGENT_ID).toBe('agent.manager-rh');
    expect(CLARIFICATION_THRESHOLD).toBeGreaterThan(0);
    expect(CLARIFICATION_THRESHOLD).toBeLessThan(1);
  });

  it('generateCampaignId returns CAMP-YYYY-NNN for campaign intents', () => {
    const year = new Date().getFullYear();
    expect(generateCampaignId('new_campaign')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
    expect(generateCampaignId('campaign_followup')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
    expect(generateCampaignId('reporting_request')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
  });

  it('generateCampaignId returns TASK-YYYY-NNN for out_of_campaign_task', () => {
    const year = new Date().getFullYear();
    expect(generateCampaignId('out_of_campaign_task')).toMatch(
      new RegExp(`^TASK-${year}-\\d{3}$`),
    );
  });
});

describe('manager-prompts — content', () => {
  it('intent prompt lists the five canonical intents', () => {
    const prompt = buildIntentClassificationPrompt();
    for (const intent of [
      'new_campaign',
      'campaign_followup',
      'out_of_campaign_task',
      'reporting_request',
      'other',
    ]) {
      expect(prompt).toContain(intent);
    }
    expect(prompt).toContain('needsClarification');
  });

  it('conversational prompt includes the closed list of 8 fields', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    for (const key of [
      'job_title',
      'seniority',
      'contract_type',
      'location',
      'salary_range',
      'start_date',
      'main_missions',
      'key_skills',
    ]) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('LISTE FERMÉE');
  });

  it('conversational prompt instructs 2-3 canonical chips when needsClarification', () => {
    const prompt = buildConversationalPrompt({
      intent: 'other',
      confidence: 0.4,
      needsClarification: true,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('CLARIFICATION');
    expect(prompt).toContain('2 à 3 chips');
    expect(prompt).toContain('below_bubble');
  });

  it('conversational prompt mentions empty pre-search hint', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('Aucune fiche archivée');
  });

  it('forces pre-search verbalization on first campaign turn (empty FDP)', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('VERBALISATION OBLIGATOIRE');
    expect(prompt).toMatch(/PREMIER tour/i);
  });

  it('skips pre-search verbalization once at least one field is filled', () => {
    const fdp = buildEmptyFDP('CAMP-2026-099');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable',
      status: 'filled',
    };
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp,
      preSearchHits: [],
    });
    expect(prompt).not.toContain('VERBALISATION OBLIGATOIRE');
  });

  it('includes switch-intent instructions when isSwitchIntent flag is set', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
      isSwitchIntent: true,
    });
    expect(prompt).toContain('BASCULE DE CONTEXTE');
    expect(prompt).toContain('page blanche');
  });

  it('conversational prompt formats FDP state when present', () => {
    const fdp = buildEmptyFDP('CAMP-2026-014');
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp,
      preSearchHits: [],
    });
    expect(prompt).toContain('CAMP-2026-014');
    expect(prompt).toContain('isComplete: false');
  });
});

describe('runManagerTurn — orchestration', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  it('chains intent classification then conversational response', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
    expect(result.classification.intent).toBe('new_campaign');
    expect(result.response.message).toContain('séniorité');
    expect(result.response.chips?.options).toContain('junior');
    expect(result.response.fieldExtractions?.job_title).toBe('Comptable senior');
  });

  it('promotes needsClarification when confidence < CLARIFICATION_THRESHOLD', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.4,
            reasoning: 'Hésitation entre new_campaign et out_of_campaign_task.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            message: "Voulez-vous lancer une campagne complète ou simplement préparer une fiche ?",
            chips: {
              placement: 'below_bubble',
              options: ['Lancer une campagne', 'Préparer une fiche'],
            },
          }),
        ),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.classification.confidence).toBe(0.4);
    expect(result.classification.needsClarification).toBe(true);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('calls searchExistingJobDescriptions for new_campaign without clarification', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });

    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock).toHaveBeenCalledWith(SIMPLE_HISTORY[0].content);
  });

  it('skips pre-search for non-campaign intents', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'reporting_request',
            confidence: 0.9,
            reasoning: 'Le DRH demande un point.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: 'Je vous prépare le bilan.' })),
      );

    await runManagerTurn({
      history: [{ role: 'user', content: 'Fais-moi un point.' }],
      fdp: null,
    });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('mints a CAMP-XXXX id for new_campaign without existing fdp', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.campaignId).toMatch(/^CAMP-\d{4}-\d{3}$/);
  });

  it('keeps the existing fdp.campaignId when fdp is provided', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    const result = await runManagerTurn({ history: SIMPLE_HISTORY, fdp });

    expect(result.campaignId).toBe('CAMP-2026-042');
    expect(result.switchIntent).toBe(false);
  });

  it('detects switch-intent when validated fdp + new_campaign with high confidence', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const validated = {
      ...buildEmptyFDP('CAMP-2026-042'),
      isComplete: true,
      isValidated: true,
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Comptable senior à Paris.' },
        { role: 'manager', content: 'FDP validée, annonce générée.' },
        { role: 'user', content: 'Maintenant je veux recruter un commercial.' },
      ],
      fdp: validated,
    });

    expect(result.switchIntent).toBe(true);
    expect(result.campaignId).not.toBe('CAMP-2026-042');
    expect(result.campaignId).toMatch(/^CAMP-\d{4}-\d{3}$/);
  });

  it('does NOT switch-intent when validated fdp + low confidence intent', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.55,
            reasoning: 'Hésitation.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const validated = {
      ...buildEmptyFDP('CAMP-2026-042'),
      isComplete: true,
      isValidated: true,
    };

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: validated,
    });

    expect(result.switchIntent).toBe(false);
    // confidence < CLARIFICATION_THRESHOLD ⇒ needsClarification=true ⇒ pas de campaignId neuf
    expect(result.campaignId).toBe('CAMP-2026-042');
  });

  it('does NOT switch-intent when fdp is not yet validated', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const inProgress = {
      ...buildEmptyFDP('CAMP-2026-042'),
      isComplete: false,
      isValidated: false,
    };

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: inProgress,
    });

    expect(result.switchIntent).toBe(false);
    expect(result.campaignId).toBe('CAMP-2026-042');
  });

  it('aggregates metrics across both LLM calls', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(VALID_INTENT, {
          durationMs: 200,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          costEstimate: 0.002,
        }),
      )
      .mockResolvedValueOnce(
        fakeCompletion(VALID_RESPONSE, {
          durationMs: 350,
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          costEstimate: 0.003,
        }),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.metrics.durationMs).toBe(550);
    expect(result.metrics.tokensUsed).toBe(70);
    expect(result.metrics.costEstimate).toBeCloseTo(0.005, 5);
  });

  it('cleans null chips/fieldExtractions before validation', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            message: 'Quelles sont les missions principales ?',
            chips: null,
            fieldExtractions: null,
          }),
        ),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.response.chips).toBeUndefined();
    expect(result.response.fieldExtractions).toBeUndefined();
  });

  it('throws ManagerError on invalid intent JSON', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('not-json'));

    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toBeInstanceOf(ManagerError);
  });

  it('throws ManagerError on invalid response shape', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: '' })),
      );

    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toMatchObject({ name: 'ManagerError' });
  });
});
