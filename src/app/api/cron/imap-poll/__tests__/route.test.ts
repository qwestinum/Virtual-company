import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/imap/poller', () => ({
  pollAllMailboxes: vi.fn().mockResolvedValue([{ mailboxId: 'm1' }]),
}));

import { pollAllMailboxes } from '@/lib/imap/poller';
import { GET } from '@/app/api/cron/imap-poll/route';

const pollMock = vi.mocked(pollAllMailboxes);

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/imap-poll', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/cron/imap-poll', () => {
  const prev = process.env.CRON_SECRET;
  beforeEach(() => pollMock.mockClear());
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it('poll sans secret configuré (ouvert)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(pollMock).toHaveBeenCalledTimes(1);
  });

  it('accepte le Bearer correct quand CRON_SECRET est défini', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    const res = await GET(req({ authorization: 'Bearer s3cr3t' }));
    expect(res.status).toBe(200);
    expect(pollMock).toHaveBeenCalledTimes(1);
  });

  it('rejette (401) un appel sans/avec mauvais Bearer quand le secret est défini', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    const noAuth = await GET(req());
    expect(noAuth.status).toBe(401);
    const wrong = await GET(req({ authorization: 'Bearer nope' }));
    expect(wrong.status).toBe(401);
    expect(pollMock).not.toHaveBeenCalled();
  });
});
