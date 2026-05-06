import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

import {
  JobWriterError,
  jobWriterAgent,
} from '@/lib/agents/contracts/job-writer';
import {
  renderJobAdMarkdown,
  suggestJobAdFileName,
} from '@/lib/agents/job-writer-render';
import { chatComplete } from '@/lib/ai/provider';
import { buildEmptyFDP } from '@/types/field-collection';

const chatCompleteMock = vi.mocked(chatComplete);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(content: string): FakeCompletion {
  return {
    content,
    model: 'gpt-4o',
    usage: { promptTokens: 200, completionTokens: 350, totalTokens: 550 },
    costEstimate: 0.011,
    durationMs: 4200,
  };
}

function buildCompleteFDP() {
  const fdp = buildEmptyFDP('CAMP-2026-007');
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
    value: ['Tenue compta', 'Clôtures', 'Déclarations fiscales'],
  };
  fdp.fields.key_skills = {
    ...fdp.fields.key_skills,
    status: 'filled',
    value: ['IFRS', 'SAP'],
  };
  fdp.isComplete = true;
  return fdp;
}

const VALID_AD = JSON.stringify({
  title: 'Comptable senior — Paris (CDI)',
  body:
    "Nous recherchons un comptable senior pour rejoindre l'équipe.\n\n## Missions\n- Tenue de la comptabilité\n- Clôtures\n\n## Profil recherché\n- Expérience confirmée\n\n## Conditions\n- CDI à Paris\n- 50-65K bruts annuels",
  tags: ['Comptabilité', 'Senior', 'Paris', 'CDI'],
});

describe('jobWriterAgent.execute', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
  });

  it('returns a parsed ad with metrics on success', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion(VALID_AD));
    const fdp = buildCompleteFDP();

    const out = await jobWriterAgent.execute({
      taskId: 't1',
      correlationId: 'c1',
      agentId: jobWriterAgent.id,
      payload: { fdp },
      context: {
        campaignId: fdp.campaignId,
        priority: 'normal',
        requestedBy: 'agent.manager-rh',
      },
    });

    expect(out.status).toBe('success');
    const ad = out.data.ad as { title: string; body: string; tags: string[] };
    expect(ad.title).toContain('Comptable');
    expect(ad.tags.length).toBeGreaterThan(0);
    expect(out.metrics.tokensUsed).toBe(550);
    expect(out.metrics.costEstimate).toBeCloseTo(0.011, 5);
  });

  it('throws JobWriterError on missing FDP payload', async () => {
    await expect(
      jobWriterAgent.execute({
        taskId: 't1',
        correlationId: 'c1',
        agentId: jobWriterAgent.id,
        payload: {},
        context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
      }),
    ).rejects.toBeInstanceOf(JobWriterError);
  });

  it('throws JobWriterError on invalid LLM response', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('not-json'));
    const fdp = buildCompleteFDP();
    await expect(
      jobWriterAgent.execute({
        taskId: 't1',
        correlationId: 'c1',
        agentId: jobWriterAgent.id,
        payload: { fdp },
        context: { priority: 'normal', requestedBy: 'agent.manager-rh' },
      }),
    ).rejects.toMatchObject({ name: 'JobWriterError' });
  });
});

describe('job-writer-render', () => {
  it('renderJobAdMarkdown puts title as H1 and footer with tags', () => {
    const md = renderJobAdMarkdown({
      title: 'Lead Comptable — Lyon (CDI)',
      body: 'Body content here.',
      tags: ['Comptabilité', 'Lyon'],
    });
    expect(md.startsWith('# Lead Comptable — Lyon (CDI)')).toBe(true);
    expect(md).toContain('Body content here.');
    expect(md).toContain('Tags');
    expect(md).toContain('Comptabilité');
  });

  it('suggestJobAdFileName produces a clean slug', () => {
    expect(suggestJobAdFileName('Comptable Senior — Paris')).toMatch(
      /^annonce-comptable-senior-paris\.md$/,
    );
    expect(suggestJobAdFileName('   ')).toBe('annonce-poste.md');
  });
});
