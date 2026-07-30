/**
 * Référentiel des recruteurs (multi-utilisateur). Un recruteur = un compte
 * Supabase Auth de l'espace (id = auth.users.id, sans FK dure — pattern
 * snapshot). Tout l'espace métier reste COMMUN ; ce qui est individuel :
 * l'agenda Cal.com (`calcomLink`), l'identité dans les actions (decided_by)
 * et l'accès admin (`role`). CLIENT-SAFE (types purs).
 */

import { z } from 'zod';

export const RECRUITER_ROLES = ['admin', 'member'] as const;
export const RecruiterRoleSchema = z.enum(RECRUITER_ROLES);
export type RecruiterRole = z.infer<typeof RecruiterRoleSchema>;

export const RecruiterSchema = z.object({
  /** = auth.users.id (UUID Supabase). */
  id: z.string().uuid(),
  displayName: z.string().min(1),
  email: z.string().email(),
  /** Lien de réservation Cal.com PERSONNEL — null ⇒ repli global. */
  calcomLink: z.string().max(2048).nullable(),
  role: RecruiterRoleSchema,
  /** Désactivation douce : sort des sélecteurs et de la résolution d'agenda,
   * les actions passées restent attribuées. Jamais de suppression. */
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type Recruiter = z.infer<typeof RecruiterSchema>;
