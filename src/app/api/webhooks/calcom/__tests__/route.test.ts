import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/interview-briefs', () => ({
  claimBookingEvent: vi.fn(),
  releaseBookingEvent: vi.fn(),
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/interview/deliver-brief', () => ({
  deliverBriefForBooking: vi.fn(),
}));

import {
  claimBookingEvent,
  releaseBookingEvent,
} from '@/lib/db/repos/interview-briefs';
import { deliverBriefForBooking } from '@/lib/interview/deliver-brief';
import { POST } from '@/app/api/webhooks/calcom/route';

const SECRET = 'whsec_test';
const claimMock = vi.mocked(claimBookingEvent);
const releaseMock = vi.mocked(releaseBookingEvent);
const deliverMock = vi.mocked(deliverBriefForBooking);

function bookingBody(uid = 'bk_1', email = 'jane@mail.com'): string {
  return JSON.stringify({
    triggerEvent: 'BOOKING_CREATED',
    createdAt: '2026-06-18T10:00:00.000Z',
    payload: {
      uid,
      attendees: [{ email, name: 'Jane Doe' }],
      startTime: '2026-06-23T12:00:00.000Z',
      endTime: '2026-06-23T12:30:00.000Z',
      location: 'Google Meet',
    },
  });
}

function requestFor(body: string, signature?: string): Request {
  const sig =
    signature ?? createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
  return new Request('http://localhost/api/webhooks/calcom', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cal-signature-256': sig },
    body,
  });
}

describe('POST /api/webhooks/calcom', () => {
  beforeEach(() => {
    process.env.CAL_COM_WEBHOOK_SECRET = SECRET;
    claimMock.mockReset();
    releaseMock.mockReset().mockResolvedValue(undefined);
    deliverMock.mockReset();
  });

  it('delivers the brief once on a first, signed BOOKING_CREATED', async () => {
    claimMock.mockResolvedValue(true);
    deliverMock.mockResolvedValue({
      ok: true,
      status: 'delivered',
      retryable: false,
      messageId: 'm1',
    });

    const res = await POST(requestFor(bookingBody()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'delivered' });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock).toHaveBeenCalledWith(
      expect.objectContaining({ bookingUid: 'bk_1', attendeeEmail: 'jane@mail.com' }),
    );
  });

  it('does NOT resend on a replay (idempotency: claim already taken)', async () => {
    claimMock.mockResolvedValue(false);

    const res = await POST(requestFor(bookingBody()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'replay' });
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without claiming or delivering', async () => {
    const res = await POST(requestFor(bookingBody(), 'deadbeef'));
    expect(res.status).toBe(401);
    expect(claimMock).not.toHaveBeenCalled();
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('releases the claim and returns 500 on a transient delivery failure (so Cal.com retries)', async () => {
    claimMock.mockResolvedValue(true);
    deliverMock.mockResolvedValue({
      ok: false,
      status: 'send_failed',
      retryable: true,
      error: 'resend down',
    });

    const res = await POST(requestFor(bookingBody()));
    expect(res.status).toBe(500);
    expect(releaseMock).toHaveBeenCalledWith('bk_1');
  });

  it('keeps the claim (200) when the candidate is unmatched — notification already sent', async () => {
    claimMock.mockResolvedValue(true);
    deliverMock.mockResolvedValue({
      ok: true,
      status: 'unmatched',
      retryable: false,
    });

    const res = await POST(requestFor(bookingBody()));
    expect(res.status).toBe(200);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('ignores a non-BOOKING_CREATED event without claiming', async () => {
    const body = JSON.stringify({
      triggerEvent: 'BOOKING_CANCELLED',
      payload: { uid: 'bk_2', attendees: [{ email: 'x@y.fr' }] },
    });
    const res = await POST(requestFor(body));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ignored' });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the webhook secret is not configured', async () => {
    delete process.env.CAL_COM_WEBHOOK_SECRET;
    const res = await POST(requestFor(bookingBody()));
    expect(res.status).toBe(500);
  });
});
