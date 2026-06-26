import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

import { chatComplete } from '@/lib/ai/provider';
import { buildScoringSystemPrompt } from '@/lib/agents/scoring-prompts';
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
      level: 'critique',
    },
    {
      label: "5+ ans d'expérience en comptabilité générale",
      level: 'critique',
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
            { label: 'A', level: 'critique' },
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

describe('buildScoringSystemPrompt — discipline de méthode (Phase 3c)', () => {
  it('contient la section méthode + les 4 méthodes + le champ verificationMethod', () => {
    const p = buildScoringSystemPrompt();
    expect(p).toMatch(/MÉTHODE DE VÉRIFICATION/);
    expect(p).toMatch(/keywords_exact/);
    expect(p).toMatch(/keywords_with_variants/);
    expect(p).toMatch(/hybrid_keywords_llm/);
    expect(p).toMatch(/llm_with_quote/);
    expect(p).toMatch(/verificationMethod/);
  });
});

describe('runScoringProposal — méthode + mots-clés (Phase 3c)', () => {
  beforeEach(() => chatCompleteMock.mockReset());

  it('parse les 4 méthodes proposées + leurs mots-clés', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          criteria: [
            { label: 'Maîtrise de Python', level: 'critique', verificationMethod: 'keywords_with_variants', keywords: ['Python', 'Django'] },
            { label: 'Certification AWS Solutions Architect', level: 'tres_important', verificationMethod: 'keywords_exact', keywords: ['AWS Solutions Architect'] },
            { label: 'Excellentes compétences relationnelles', level: 'important', verificationMethod: 'llm_with_quote', keywords: [] },
            { label: "Expérience management d'équipe", level: 'critique', verificationMethod: 'hybrid_keywords_llm', keywords: ['manager', 'management'] },
            { label: 'Anglais courant', level: 'souhaitable', verificationMethod: 'keywords_with_variants', keywords: ['anglais'] },
          ],
        }),
      ),
    );
    const out = await runScoringProposal(buildCompleteFDP());
    const by = (s: string) => out.criteria.find((c) => c.label.includes(s))!;
    expect(by('Python').verificationMethod).toBe('keywords_with_variants');
    expect(by('AWS').verificationMethod).toBe('keywords_exact');
    expect(by('relationnelles').verificationMethod).toBe('llm_with_quote');
    expect(by('management').verificationMethod).toBe('hybrid_keywords_llm');
    expect(by('Python').keywords).toEqual(['Python', 'Django']);
  });

  it('tolérant : réponse SANS les nouveaux champs → fallback (champs non matérialisés)', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion(VALID_LLM_RESPONSE));
    const out = await runScoringProposal(buildCompleteFDP());
    expect(out.criteria.every((c) => c.verificationMethod === undefined)).toBe(true);
    expect(out.criteria.every((c) => c.keywords === undefined)).toBe(true);
  });
});
