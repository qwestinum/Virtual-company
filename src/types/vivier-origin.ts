/**
 * Origine « vivier » d'une candidature (fix/vivier-replanif-filtres, point 1).
 *
 * Un profil du vivier proposé sur une campagne, que le recruteur INVITE depuis
 * cette campagne, devient une candidature à part entière. Ce qui la distingue
 * d'un CV arrivé par mail tient ici : d'où vient le CV, quand il date, quand le
 * profil a été proposé, qui l'a invité. Porté DANS l'application (JSON de
 * l'analyse) — la fiche, le PDF d'audit et le mail le lisent sans jointure.
 */
import { z } from 'zod';

export const VivierOriginSchema = z.object({
  vivierCandidateId: z.string().min(1),
  /** Date du CV : sa candidature d'origine, à défaut son entrée au vivier. */
  cvDate: z.string().min(1),
  cvDateKind: z.enum(['application', 'vivier_entry']),
  /** Poste de la candidature d'origine (absent pour une entrée au vivier). */
  previousJobTitle: z.string().nullable(),
  /** La présélection a proposé le profil sur cette campagne. */
  proposedAt: z.string().nullable(),
  /** Le score sur la grille de la campagne, calculé à l'invitation. */
  scoredAt: z.string().min(1),
  invitedAt: z.string().min(1),
  invitedBy: z.object({ id: z.string().nullable(), name: z.string().nullable() }),
});
export type VivierOrigin = z.infer<typeof VivierOriginSchema>;
