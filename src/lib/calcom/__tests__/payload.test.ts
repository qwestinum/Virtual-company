import { describe, expect, it } from 'vitest';

import { parseCalcomBooking } from '@/lib/calcom/payload';

describe('parseCalcomBooking', () => {
  it('extracts uid, first attendee email/name and slot from a BOOKING_CREATED envelope', () => {
    const raw = {
      triggerEvent: 'BOOKING_CREATED',
      createdAt: '2026-06-18T10:00:00.000Z',
      payload: {
        uid: 'bk_123',
        bookingId: 100,
        organizer: { email: 'orga@corp.fr', name: 'Orga' },
        attendees: [
          { email: 'Jane.Doe@Mail.com', name: 'Jane Doe', timeZone: 'Europe/Paris' },
        ],
        startTime: '2026-06-23T12:00:00.000Z',
        endTime: '2026-06-23T12:30:00.000Z',
        location: 'Google Meet',
        extraFieldWeIgnore: true,
      },
    };
    const out = parseCalcomBooking(raw);
    expect(out).toEqual({
      triggerEvent: 'BOOKING_CREATED',
      bookingUid: 'bk_123',
      attendeeEmail: 'Jane.Doe@Mail.com',
      attendeeName: 'Jane Doe',
      startTime: '2026-06-23T12:00:00.000Z',
      endTime: '2026-06-23T12:30:00.000Z',
      location: 'Google Meet',
    });
  });

  it('keeps the trigger so non-BOOKING_CREATED events can be filtered by the caller', () => {
    const out = parseCalcomBooking({
      triggerEvent: 'BOOKING_CANCELLED',
      payload: { uid: 'bk_9', attendees: [] },
    });
    expect(out?.triggerEvent).toBe('BOOKING_CANCELLED');
  });

  it('returns a null attendee email when none is present', () => {
    const out = parseCalcomBooking({
      triggerEvent: 'BOOKING_CREATED',
      payload: { uid: 'bk_9', attendees: [{ name: 'No Email' }] },
    });
    expect(out?.attendeeEmail).toBeNull();
  });

  it('returns null for a shape that is not a Cal.com envelope', () => {
    expect(parseCalcomBooking({ foo: 'bar' })).toBeNull();
    expect(parseCalcomBooking(null)).toBeNull();
    expect(parseCalcomBooking({ triggerEvent: 'X' })).toBeNull();
  });
});
