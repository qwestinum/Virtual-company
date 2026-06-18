/**
 * Parsing tolérant du payload webhook Cal.com (juin 2026).
 *
 * Enveloppe : `{ triggerEvent, createdAt, payload }`. On n'extrait que ce dont
 * la délivrance a besoin — uid (idempotence), email du candidat (matching),
 * nom, créneau, lieu. `passthrough` car le payload Cal.com est volumineux et
 * évolutif : on ignore le reste sans casser.
 */

import { z } from 'zod';

const AttendeeSchema = z
  .object({
    email: z.string().email().optional().nullable(),
    name: z.string().optional().nullable(),
  })
  .passthrough();

const PayloadSchema = z
  .object({
    uid: z.string().min(1),
    attendees: z.array(AttendeeSchema).optional().default([]),
    startTime: z.string().optional().nullable(),
    endTime: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
  })
  .passthrough();

const EnvelopeSchema = z
  .object({
    triggerEvent: z.string(),
    payload: PayloadSchema,
  })
  .passthrough();

export type CalcomBooking = {
  triggerEvent: string;
  bookingUid: string;
  /** Premier attendee = le candidat. `null` si absent (rare). */
  attendeeEmail: string | null;
  attendeeName: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
};

/**
 * Projette une enveloppe Cal.com en `CalcomBooking`. `null` si la forme ne
 * correspond pas (on répond alors 200 « ignoré », pas une erreur).
 */
export function parseCalcomBooking(raw: unknown): CalcomBooking | null {
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { triggerEvent, payload } = parsed.data;
  const first = payload.attendees.find((a) => a.email);
  return {
    triggerEvent,
    bookingUid: payload.uid,
    attendeeEmail: first?.email ?? null,
    attendeeName: first?.name ?? null,
    startTime: payload.startTime ?? null,
    endTime: payload.endTime ?? null,
    location: payload.location ?? null,
  };
}
