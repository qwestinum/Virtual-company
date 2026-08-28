/**
 * Validation du lieu de rencontre à la frontière HTTP.
 *
 * Le module de réservation définit le TYPE (`MeetingLocation`, opaque et sans
 * dépendance) ; le schéma zod, lui, appartient à l'hôte : c'est lui qui reçoit
 * du JSON venu du navigateur. Le garder ici évite d'imposer zod au module —
 * sa liste de dépendances autorisées est une frontière, pas une préférence.
 */
import { z } from 'zod';

/**
 * ⚠️ Le détail est OBLIGATOIRE dès qu'un type est choisi (`.min(1)` après
 * `.trim()`).
 *
 * Ce n'est pas de la rigueur gratuite : le schéma acceptait la chaîne vide
 * alors que `parseMeetingLocation` (côté module) rend `null` sur un détail
 * vide. Les deux moitiés du système n'étaient pas d'accord — on ENREGISTRAIT
 * un « Par téléphone » sans consigne, et on le RELISAIT comme « aucun lieu »,
 * donc on retombait en silence sur le lieu du référent. Un candidat pouvait
 * ainsi recevoir un lien de visioconférence pour un entretien qu'on croyait
 * téléphonique — ou, si le référent n'avait rien non plus, un rendez-vous
 * confirmé sans aucune indication de lieu.
 *
 * Un lieu sans détail n'est pas un lieu : il n'y a donc rien à enregistrer.
 * « Aucun lieu » s'exprime par `null`, jamais par un type au détail vide.
 */
export const MeetingLocationSchema = z.union([
  z.object({
    type: z.literal('video'),
    payload: z.object({ url: z.string().trim().min(1).max(2048) }),
  }),
  z.object({
    type: z.literal('in_person'),
    payload: z.object({ address: z.string().trim().min(1).max(500) }),
  }),
  z.object({
    type: z.literal('phone'),
    payload: z.object({ instructions: z.string().trim().min(1).max(500) }),
  }),
]);
