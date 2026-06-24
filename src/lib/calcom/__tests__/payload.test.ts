import { describe, expect, it } from 'vitest';

import { parseCalcomBooking, resolveMeetingLocation } from '@/lib/calcom/payload';

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

  it('resolves location to the real video link (metadata.videoCallUrl) over the label', () => {
    const out = parseCalcomBooking({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'bk_vid',
        attendees: [{ email: 'jane@mail.com', name: 'Jane' }],
        startTime: '2026-06-23T12:00:00.000Z',
        endTime: '2026-06-23T12:30:00.000Z',
        location: 'Google Meet', // libellé non cliquable
        metadata: { videoCallUrl: 'https://meet.google.com/abc-defg-hij' },
      },
    });
    expect(out?.location).toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('resolveMeetingLocation', () => {
  it('privilégie metadata.videoCallUrl', () => {
    expect(
      resolveMeetingLocation({
        location: 'Google Meet',
        metadata: { videoCallUrl: 'https://meet.google.com/x' },
      }),
    ).toBe('https://meet.google.com/x');
  });

  it('retombe sur videoCallData.url si pas de metadata', () => {
    expect(
      resolveMeetingLocation({
        location: 'Cal Video',
        videoCallData: { url: 'https://app.cal.com/video/xyz' },
      }),
    ).toBe('https://app.cal.com/video/xyz');
  });

  it('garde location si c’est déjà une URL ou une adresse physique', () => {
    expect(resolveMeetingLocation({ location: 'https://zoom.us/j/123' })).toBe(
      'https://zoom.us/j/123',
    );
    expect(resolveMeetingLocation({ location: '12 rue de la Paix, Paris' })).toBe(
      '12 rue de la Paix, Paris',
    );
  });

  it('écarte un identifiant interne « integrations:* » (→ null)', () => {
    expect(resolveMeetingLocation({ location: 'integrations:daily' })).toBeNull();
  });

  it('ignore un videoCallUrl non-http et retombe sur le lieu', () => {
    expect(
      resolveMeetingLocation({
        location: 'Sur site',
        metadata: { videoCallUrl: 'integrations:daily' },
      }),
    ).toBe('Sur site');
  });

  it('null/absence → null', () => {
    expect(resolveMeetingLocation({})).toBeNull();
    expect(resolveMeetingLocation({ location: null })).toBeNull();
    expect(resolveMeetingLocation({ location: '   ' })).toBeNull();
  });
});
