import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  associateMailbox,
  dissociateMailbox,
} from '@/lib/campaign/mailbox-association';

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeRes(status: number, body?: unknown, nonJson = false): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (nonJson) throw new Error('not json');
      return body ?? {};
    },
  };
}

describe('mailbox-association — issue remontée (pas d’avalage)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('associate 204 → { ok: true } et POST /associate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(204));
    vi.stubGlobal('fetch', fetchMock);

    const out = await associateMailbox('MB-1', 'CAMP-1');

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mailboxes/MB-1/associate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('associate 503 → succès démo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(503)));
    expect(await associateMailbox('MB-1', 'CAMP-1')).toEqual({
      ok: true,
      demo: true,
    });
  });

  it('associate 500 avec message → échec remonté', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeRes(500, { message: 'db down' })),
    );
    expect(await associateMailbox('MB-1', 'CAMP-1')).toEqual({
      ok: false,
      error: 'db down',
    });
  });

  it('associate erreur réseau → échec, jamais avalé', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await associateMailbox('MB-1', 'CAMP-1')).toEqual({
      ok: false,
      error: 'offline',
    });
  });

  it('dissociate 204 → { ok: true } et DELETE avec campaign_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(204));
    vi.stubGlobal('fetch', fetchMock);

    const out = await dissociateMailbox('MB-1', 'CAMP-1');

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mailboxes/MB-1/associate?campaign_id=CAMP-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('dissociate 400 non-JSON → repli HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(400, null, true)));
    expect(await dissociateMailbox('MB-1', 'CAMP-1')).toEqual({
      ok: false,
      error: 'HTTP 400',
    });
  });
});
