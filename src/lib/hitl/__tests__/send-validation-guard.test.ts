/**
 * Chemin d'envoi HITL côté client — la décision AFFICHÉE voyage avec la
 * réservation, et un refus du serveur arrête tout (27/09/2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendValidation } from '@/lib/hitl/send-validation';
import type { PendingValidation } from '@/types/hitl';

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
    confirmed: true,
    status: 'pending',
    payload: { candidate: { candidateName: 'Jean Test', email: 'jean@mail.com' }, uid: 'u1' },
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-01T08:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
    ...over,
  };
}

const draft = { subject: 'Objet', html: '<p>Corps</p>' };

function respond(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendValidation — garde de décision', () => {
  it('la réservation porte la décision affichée', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/reserve-send')
        ? respond(200, { reserved: true })
        : respond(200, { status: 'sent', providerMessageId: 'm1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendValidation(makeValidation({ decision: 'accept' }), draft);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/validations/pv_1/reserve-send');
    expect(JSON.parse(init.body as string)).toEqual({ expectedDecision: 'accept' });
  });

  it('décision changée en base ⇒ rien ne part, rien n’est finalisé', async () => {
    const fetchMock = vi.fn(async () =>
      respond(409, { error: 'decision_changed', current: 'reject' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendValidation(makeValidation({ decision: 'accept' }), draft);

    expect(res.ok).toBe(false);
    expect(res.message).toContain('rien n’a été envoyé');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mail refusé par la seconde ceinture ⇒ pas de finalisation', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/reserve-send')
        ? respond(200, { reserved: true })
        : respond(409, { error: 'decision_mismatch' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendValidation(makeValidation({ decision: 'accept' }), draft);

    expect(res.ok).toBe(false);
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual(['/api/validations/pv_1/reserve-send', '/api/mail-composer']);
  });
});
