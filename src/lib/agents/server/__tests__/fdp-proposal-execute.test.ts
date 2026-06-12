import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { chatCompleteMock } = vi.hoisted(() => ({
  chatCompleteMock: vi.fn(),
}));

vi.mock('@/lib/ai/provider', () => ({ chatComplete: chatCompleteMock }));

import {
  runFdpProposal,
  FdpProposalError,
} from '@/lib/agents/server/fdp-proposal-execute';

function completion(content: string) {
  return {
    content,
    usage: { totalTokens: 10 },
    costEstimate: 0,
    durationMs: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runFdpProposal', () => {
  it('coerce les champs et force job_title à la valeur fournie', async () => {
    chatCompleteMock.mockResolvedValue(
      completion(
        JSON.stringify({
          fields: {
            job_title: 'IGNORÉ', // doit être écrasé par la valeur DRH
            seniority: 'senior',
            contract_type: 'CDI',
            location: 'Paris',
            salary_range: '50-65K bruts annuels',
            start_date: 'Dès que possible',
            main_missions: ['Clôtures', 'Déclarations'],
            key_skills: ['IFRS', 'SAP'],
          },
        }),
      ),
    );
    const { fields } = await runFdpProposal({ jobTitle: 'Comptable senior' });
    expect(fields.job_title).toBe('Comptable senior');
    expect(fields.seniority).toBe('senior');
    expect(fields.contract_type).toBe('CDI');
    expect(fields.main_missions).toEqual(['Clôtures', 'Déclarations']);
    expect(fields.key_skills).toEqual(['IFRS', 'SAP']);
  });

  it('écarte un énum invalide sans rejeter la proposition', async () => {
    chatCompleteMock.mockResolvedValue(
      completion(
        JSON.stringify({
          fields: { seniority: 'lead', contract_type: 'CDI' },
        }),
      ),
    );
    const { fields } = await runFdpProposal({ jobTitle: 'Dev' });
    expect(fields.seniority).toBeUndefined();
    expect(fields.contract_type).toBe('CDI');
  });

  it('coerce une liste fournie en chaîne unique vers un tableau', async () => {
    chatCompleteMock.mockResolvedValue(
      completion(
        JSON.stringify({ fields: { main_missions: 'Tenue de la compta' } }),
      ),
    );
    const { fields } = await runFdpProposal({ jobTitle: 'Comptable' });
    expect(fields.main_missions).toEqual(['Tenue de la compta']);
  });

  it('rejette un JSON illisible', async () => {
    chatCompleteMock.mockResolvedValue(completion('pas du json'));
    await expect(runFdpProposal({ jobTitle: 'X' })).rejects.toBeInstanceOf(
      FdpProposalError,
    );
  });

  it('rejette une forme invalide (fields absent)', async () => {
    chatCompleteMock.mockResolvedValue(completion(JSON.stringify({ foo: 1 })));
    await expect(runFdpProposal({ jobTitle: 'X' })).rejects.toMatchObject({
      code: 'invalid_response_shape',
    });
  });
});
