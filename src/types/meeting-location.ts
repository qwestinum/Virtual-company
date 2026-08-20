/**
 * Validation du lieu de rencontre à la frontière HTTP.
 *
 * Le module de réservation définit le TYPE (`MeetingLocation`, opaque et sans
 * dépendance) ; le schéma zod, lui, appartient à l'hôte : c'est lui qui reçoit
 * du JSON venu du navigateur. Le garder ici évite d'imposer zod au module —
 * sa liste de dépendances autorisées est une frontière, pas une préférence.
 */
import { z } from 'zod';

export const MeetingLocationSchema = z.union([
  z.object({
    type: z.literal('video'),
    payload: z.object({ url: z.string().max(2048) }),
  }),
  z.object({
    type: z.literal('in_person'),
    payload: z.object({ address: z.string().max(500) }),
  }),
  z.object({
    type: z.literal('phone'),
    payload: z.object({ instructions: z.string().max(500) }),
  }),
]);
