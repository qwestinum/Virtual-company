/**
 * Construction du PROFIL DISTILLÉ embeddé d'un dossier vivier (Session V3 —
 * correctif de pertinence).
 *
 * Problème résolu : embedder le CV brut ENTIER (document long, bruité) puis le
 * comparer à une requête de présélection COURTE produit des similarités cosinus
 * tassées et peu discriminantes (formes incompatibles). On embedde donc un
 * profil court, centré métier, de "forme" comparable à la requête : la tête du
 * CV (où figurent en général titre + résumé) + le relevé d'entités structurées
 * (technologies, certifications, diplômes, secteurs, langues, expérience,
 * localisation). Pur (testable).
 */

import type { VivierEntities } from '@/types/vivier';

/**
 * Tête de CV incluse (titre/résumé en haut, en général). Volontairement COURTE :
 * une tête trop longue (prose générique) noie le relevé d'entités et tasse les
 * similarités. On garde juste de quoi capter le titre/headline.
 */
export const PROFILE_CV_HEAD_CHARS = 500;

export function buildVivierProfileText(
  entities: VivierEntities,
  cvText: string,
): string {
  const lines: string[] = [];
  if (entities.technologies.length)
    lines.push(`Technologies : ${entities.technologies.join(', ')}`);
  if (entities.certifications.length)
    lines.push(`Certifications : ${entities.certifications.join(', ')}`);
  if (entities.diplomes.length)
    lines.push(`Diplômes : ${entities.diplomes.join(', ')}`);
  if (entities.secteurs.length)
    lines.push(`Secteurs : ${entities.secteurs.join(', ')}`);
  if (entities.langues.length)
    lines.push(`Langues : ${entities.langues.join(', ')}`);
  if (entities.experienceYears != null)
    lines.push(`Expérience : ${entities.experienceYears} ans`);
  if (entities.localisation)
    lines.push(`Localisation : ${entities.localisation}`);

  const head = cvText.trim().slice(0, PROFILE_CV_HEAD_CHARS);
  // Entités D'ABORD (signal métier discriminant), puis tête de CV courte
  // (titre/headline). L'embedding moyennant les tokens, c'est la PROPORTION qui
  // compte : on veut que les entités pèsent, pas qu'elles soient un appendice.
  const profile = [lines.join('\n'), head]
    .filter((s) => s.trim().length > 0)
    .join('\n\n')
    .trim();
  // Repli sur le CV si, par extraordinaire, profil + tête sont vides.
  return profile || cvText.trim();
}
