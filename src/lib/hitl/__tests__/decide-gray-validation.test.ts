/**
 * Non-régression du chemin d'envoi HITL (zone grise). `ValidationsHub` →
 * `ValidationCard` → `decideGrayValidation` est le SEUL chemin ; on verrouille
 * ici sa séquence (PATCH-confirm conditionnel + sendValidation) pour garantir
 * que l'extraction n'a rien changé au comportement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGrayValidation } from '@/lib/hitl/decide-gray-validation';
import { sendValidation } from '@/lib/hitl/send-validation';
import type { PendingValidation } from '@/types/hitl';

vi.mock('@/lib/hitl/send-validation', () => ({
  sendValidation: vi.fn(async () => ({ ok: true, message: 'envoyé' })),
}));

const sendMock = vi.mocked(sendValidation);

function makeValidation(over: Partial<PendingValidation> = {}): PendingValidation {
  return {
    id: 'pv_1',
    campaignId: 'CAMP-1',
    candidateName: 'Jean Test',
    candidateEmail: 'jean@mail.com',
    score: 62,
    decision: 'accept',
    cvArtifactId: null,
    reportArtifactId: null,
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: { candidate: { candidateName: 'Jean Test' } },
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-01T08:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
    ...over,
  };
}

const draft = { subject: 'Objet', html: '<p>Corps</p>' };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('decideGrayValidation — non-régression du chemin d’envoi', () => {
  it('ne PATCH pas quand la décision est identique à la proposition, et envoie', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const v = makeValidation({ decision: 'accept' });
    const res = await decideGrayValidation(v, 'accept', draft);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ ...v, decision: 'accept' }, draft);
    expect(res).toEqual({ ok: true, message: 'envoyé' });
  });

  it('PATCH { decision, confirmed:true } quand la décision diffère, puis envoie', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const v = makeValidation({ decision: 'accept' });
    await decideGrayValidation(v, 'reject', draft);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/validations/pv_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'reject', confirmed: true });
    // L'envoi part bien avec la décision TRANCHÉE.
    expect(sendMock).toHaveBeenCalledWith({ ...v, decision: 'reject' }, draft);
  });

  it('n’envoie pas si la persistance de la décision échoue (HTTP non-ok)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const v = makeValidation({ decision: 'accept' });
    const res = await decideGrayValidation(v, 'reject', draft);

    expect(sendMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('n’envoie pas sur erreur réseau du PATCH', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', fetchMock);

    const v = makeValidation({ decision: 'accept' });
    const res = await decideGrayValidation(v, 'reject', draft);

    expect(sendMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});
