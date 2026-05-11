import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

import { chatComplete } from '@/lib/ai/provider';
import {
  runScoringProposal,
  ScoringProposalError,
} from '@/lib/agents/server/scoring-execute';
import { buildEmptyFDP } from '@/types/field-collection';
import { DEFAULT_WEIGHTS } from '@/types/scoring';

const chatCompleteMock = vi.mocked(chatComplete);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(content: string): FakeCompletion {
  return {
    content,
    model: 'gpt-4o',
    usage: { promptTokens: 300, completionTokens: 200, totalTokens: 500 },
    costEstimate: 0.009,
    durationMs: 3800,
  };
}

function buildCompleteFDP() {
  const fdp = buildEmptyFDP('CAMP-2026-100');
  fdp.fields.job_title = {
    ...fdp.fields.job_title,
    status: 'filled',
    value: 'Comptable senior',
  };
  fdp.fields.seniority = {
    ...fdp.fields.seniority,
    status: 'filled',
    value: 'senior',
  };
  fdp.fields.contract_type = {
    ...fdp.fields.contract_type,
    status: 'filled',
    value: 'CDI',
  };
  fdp.fields.location = {
    ...fdp.fields.location,
    status: 'filled',
    value: 'Paris',
  };
  fdp.fields.salary_range = {
    ...fdp.fields.salary_range,
    status: 'filled',
    value: '50-65K bruts annuels',
  };
  fdp.fields.start_date = {
    ...fdp.fields.start_date,
    status: 'filled',
    value: 'septembre 2026',
  };
  fdp.fields.main_missions = {
    ...fdp.fields.main_missions,
    status: 'filled',
    value: ['Tenue compta générale', 'Clôtures', 'Déclarations fiscales'],
  };
  fdp.fields.key_skills = {
    ...fdp.fields.key_skills,
    status: 'filled',
    value: ['IFRS', 'SAP', 'Excel avancé'],
  };
  return fdp;
}

const VALID_LLM_RESPONSE = JSON.stringify({
  criteria: [
    {
      label: 'Diplôme comptable Bac+5 (DSCG/DEC)',
      level: 'obligatoire',
    },
    {
      label: "5+ ans d'expérience en comptabilité générale",
      level: 'obligatoire',
    },
    { label: 'Maîtrise des normes IFRS', level: 'critique' },
    { label: 'Pratique avérée de SAP', level: 'tres_important' },
    { label: 'Excel avancé', level: 'tres_important' },
    { label: 'Expérience clôtures mensuelles', level: 'important' },
    { label: 'Expérience en cabinet Big 4', level: 'souhaitable' },
    { label: 'Anglais courant écrit/oral', level: 'souhaitable' },
  ],
});

describe('runScoringProposal', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
  });

  it('parses LLM response and derives default weights per level', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion(VALID_LLM_RESPONSE));
    const fdp = buildCompleteFDP();

    const out = await runScoringProposal(fdp);

    expect(out.criteria).toHaveLength(8);
    const byLevel = (level: string) =>
      out.criteria.find((c) => c.level === level);
    expect(byLevel('obligatoire')?.weight).toBe(DEFAULT_WEIGHTS.obligatoire);
    expect(byLevel('critique')?.weight).toBe(DEFAULT_WEIGHTS.critique);
    expect(byLevel('tres_important')?.weight).toBe(
      DEFAULT_WEIGHTS.tres_important,
    );
    expect(byLevel('souhaitable')?.weight).toBe(DEFAULT_WEIGHTS.souhaitable);
    // Les ids sont déterministes par index pour audit/debug.
    expect(out.criteria[0]?.id).toBe('proposed_1');
    expect(out.criteria[7]?.id).toBe('proposed_8');
  });

  it('aggregates metrics from the LLM call', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion(VALID_LLM_RESPONSE));
    const fdp = buildCompleteFDP();
    const out = await runScoringProposal(fdp);
    expect(out.metrics.tokensUsed).toBe(500);
    expect(out.metrics.costEstimate).toBeCloseTo(0.009, 5);
  });

  it('throws ScoringProposalError on invalid JSON', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('not-json'));
    await expect(runScoringProposal(buildCompleteFDP())).rejects.toBeInstanceOf(
      ScoringProposalError,
    );
  });

  it('throws ScoringProposalError on too few criteria (< 5)', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          criteria: [
            { label: 'A', level: 'obligatoire' },
            { label: 'B', level: 'critique' },
          ],
        }),
      ),
    );
    await expect(runScoringProposal(buildCompleteFDP())).rejects.toMatchObject({
      code: 'invalid_response_shape',
    });
  });

  it('throws ScoringProposalError on unknown level', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          criteria: Array.from({ length: 5 }).map((_, i) => ({
            label: `crit ${i}`,
            level: 'super_important',
          })),
        }),
      ),
    );
    await expect(runScoringProposal(buildCompleteFDP())).rejects.toMatchObject({
      code: 'invalid_response_shape',
    });
  });
});
