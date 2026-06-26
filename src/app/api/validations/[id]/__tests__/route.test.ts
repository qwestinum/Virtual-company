import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-api-user', () => ({
  getApiUser: vi.fn(),
}));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  patchPendingValidation: vi.fn(),
}));

import { PATCH } from '@/app/api/validations/[id]/route';
import { getApiUser } from '@/lib/auth/require-api-user';
import { patchPendingValidation } from '@/lib/db/repos/pending-validations';

const getApiUserMock = vi.mocked(getApiUser);
const patchMock = vi.mocked(patchPendingValidation);

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/validations/PV-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'PV-1' }) };

describe('PATCH /api/validations/[id] — capture du valideur', () => {
  beforeEach(() => {
    patchMock.mockReset();
    getApiUserMock.mockReset();
    // Renvoi non-null pour un 200 ; le contenu n'importe pas pour ces tests.
    patchMock.mockResolvedValue({ id: 'PV-1' } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("confirmed=true : pose decided_by='user' + identité depuis la SESSION serveur", async () => {
    getApiUserMock.mockResolvedValue({
      id: 'usr-session-uuid',
      email: 'rh@client.fr',
    } as never);

    await PATCH(patchRequest({ confirmed: true }), ctx);

    expect(getApiUserMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('PV-1', {
      confirmed: true,
      decidedBy: 'user',
      decidedByUser: { userId: 'usr-session-uuid', email: 'rh@client.fr' },
    });
  });

  it('anti-falsification : une identité envoyée dans le PAYLOAD client est IGNORÉE', async () => {
    getApiUserMock.mockResolvedValue({
      id: 'usr-session-uuid',
      email: 'rh@client.fr',
    } as never);

    await PATCH(
      patchRequest({
        confirmed: true,
        // Tentative de forge — ces champs ne sont PAS dans PatchSchema (strip Zod).
        decidedBy: 'auto',
        decidedByUser: { userId: 'attacker', email: 'evil@bad.fr' },
      }),
      ctx,
    );

    const [, patch] = patchMock.mock.calls[0]!;
    // L'identité retenue est celle de la session, jamais celle du payload.
    expect(patch.decidedBy).toBe('user');
    expect(patch.decidedByUser).toEqual({
      userId: 'usr-session-uuid',
      email: 'rh@client.fr',
    });
  });

  it('confirmed absent (ex. flip de décision) : ne capture aucun valideur', async () => {
    await PATCH(patchRequest({ decision: 'reject' }), ctx);

    expect(getApiUserMock).not.toHaveBeenCalled();
    expect(patchMock).toHaveBeenCalledWith('PV-1', { decision: 'reject' });
  });

  it("confirmed=true sans session : decided_by='user' mais identité null", async () => {
    getApiUserMock.mockResolvedValue(null);

    await PATCH(patchRequest({ confirmed: true }), ctx);

    expect(patchMock).toHaveBeenCalledWith('PV-1', {
      confirmed: true,
      decidedBy: 'user',
      decidedByUser: null,
    });
  });
});
