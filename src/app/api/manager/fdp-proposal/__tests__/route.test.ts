import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runFdpProposalMock } = vi.hoisted(() => ({
  runFdpProposalMock: vi.fn(),
}));

vi.mock('@/lib/agents/server/fdp-proposal-execute', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/server/fdp-proposal-execute')>()),
  runFdpProposal: runFdpProposalMock,
}));

import { POST } from '@/app/api/manager/fdp-proposal/route';
import { FdpProposalError } from '@/lib/agents/server/fdp-proposal-execute';

function request(body: unknown): Request {
  return new Request('http://test/api/manager/fdp-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/manager/fdp-proposal', () => {
  it('400 sur payload invalide (jobTitle manquant)', async () => {
    const res = await POST(request({ foo: 'bar' }));
    expect(res.status).toBe(400);
    expect(runFdpProposalMock).not.toHaveBeenCalled();
  });

  it('200 renvoie les champs proposés', async () => {
    runFdpProposalMock.mockResolvedValue({
      fields: { job_title: 'Comptable', seniority: 'senior' },
      metrics: { durationMs: 1, tokensUsed: 2, costEstimate: 0 },
    });
    const res = await POST(request({ jobTitle: 'Comptable' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { fields: Record<string, unknown> };
    expect(data.fields.seniority).toBe('senior');
    expect(runFdpProposalMock).toHaveBeenCalledWith({
      jobTitle: 'Comptable',
      known: undefined,
    });
  });

  it('502 sur FdpProposalError', async () => {
    runFdpProposalMock.mockRejectedValue(
      new FdpProposalError('invalid_response_shape', 'bad'),
    );
    const res = await POST(request({ jobTitle: 'Comptable' }));
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('invalid_response_shape');
  });
});
