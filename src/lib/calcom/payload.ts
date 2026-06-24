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
    // Lien VISIO réel : Cal.com le place dans `metadata.videoCallUrl` (champ
    // standard, tous providers) ou `videoCallData.url`. `location` n'est souvent
    // qu'un LIBELLÉ (« Google Meet ») ou un identifiant (« integrations:daily »).
    // `.catch(null)` : tolérant aux variations de forme (Cal.com évolutif).
    metadata: z
      .object({ videoCallUrl: z.string().nullish().catch(null) })
      .passthrough()
      .nullish(),
    videoCallData: z
      .object({ url: z.string().nullish().catch(null) })
      .passthrough()
      .nullish(),
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

/** Une chaîne est-elle une URL http(s) ? Pur. */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Résout le « lieu » de l'entretien en privilégiant le LIEN VISIO réel, pour
 * qu'il atterrisse dans `LOCATION` du .ics (cliquable) plutôt qu'un libellé :
 *   1. `metadata.videoCallUrl` (champ standard Cal.com, tous providers) ;
 *   2. `videoCallData.url` (repli) ;
 *   3. `location` si c'est une URL, une adresse physique ou un libellé humain.
 * Les identifiants internes « integrations:* » (non cliquables, non humains)
 * sont ÉCARTÉS (→ `null`) plutôt que de polluer le champ. Pur et déterministe.
 */
export function resolveMeetingLocation(payload: {
  location?: string | null;
  metadata?: { videoCallUrl?: string | null } | null;
  videoCallData?: { url?: string | null } | null;
}): string | null {
  const videoUrl =
    payload.metadata?.videoCallUrl?.trim() || payload.videoCallData?.url?.trim();
  if (videoUrl && isHttpUrl(videoUrl)) return videoUrl;
  const loc = payload.location?.trim();
  if (!loc || loc.toLowerCase().startsWith('integrations:')) return null;
  return loc;
}

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
    // Lieu résolu = lien visio réel si présent (cf. resolveMeetingLocation).
    location: resolveMeetingLocation(payload),
  };
}
