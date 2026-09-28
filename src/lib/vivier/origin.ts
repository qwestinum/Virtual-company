/**
 * Candidature issue du vivier — règles PURES (fix/vivier-replanif-filtres,
 * point 1). Identifiants, libellés, phrase du message. Aucun I/O.
 */
import { formatFrDate } from '@/lib/reporting/audit-display';
import type { VivierOrigin } from '@/types/vivier-origin';

export const VIVIER_ANALYSIS_PREFIX = 'can_viv_';

/**
 * UNE candidature par (campagne, profil) : l'identifiant est DÉRIVÉ des deux,
 * jamais tiré au hasard — un double clic, une reprise après panne retrouvent
 * la même ligne (insertion seule) et le même verrou d'envoi.
 */
export function vivierAnalysisId(campaignId: string, vivierCandidateId: string): string {
  return `${VIVIER_ANALYSIS_PREFIX}${campaignId}_${vivierCandidateId}`;
}

/** Le CV COPIÉ dans les artefacts de la candidature (le vivier garde le sien). */
export function vivierCvArtifactId(analysisId: string): string {
  return `art_viv_cv_${analysisId.slice(VIVIER_ANALYSIS_PREFIX.length)}`;
}

export function isVivierAnalysisId(id: string | null | undefined): boolean {
  return (id ?? '').startsWith(VIVIER_ANALYSIS_PREFIX);
}

/**
 * « Score de présélection vivier — calculé le 28 septembre 2026 sur le CV du
 * 12 mars 2026 ». Le score n'est pas celui d'une candidature reçue : il juge un
 * CV peut-être ancien, et l'écran doit le dire.
 */
export function vivierScoreLabel(origin: VivierOrigin): string {
  return `Score de présélection vivier — calculé le ${formatFrDate(origin.scoredAt)} sur le CV du ${formatFrDate(origin.cvDate)}`;
}

/** « proposé le …, invité par … le … » (détail de la frise). */
export function vivierTimelineDetail(origin: VivierOrigin): string {
  const proposed = origin.proposedAt ? `proposé le ${formatFrDate(origin.proposedAt)}, ` : '';
  const by = origin.invitedBy.name ? ` par ${origin.invitedBy.name}` : '';
  return `${proposed}invité${by} le ${formatFrDate(origin.invitedAt)}`;
}

/** « Issu du vivier — proposé le …, invité par … le … » (fiche). */
export function vivierTimelineLabel(origin: VivierOrigin): string {
  return `Issu du vivier — ${vivierTimelineDetail(origin)}`;
}

/**
 * La phrase qui dit au candidat d'où vient la sollicitation. Une candidature
 * d'origine connue ⇒ on la rappelle ; sinon on dit seulement que son CV était
 * chez nous — jamais « vous nous aviez écrit » à quelqu'un qui ne l'a pas fait
 * (un CV importé d'un stock n'est pas une candidature adressée).
 */
export function vivierOriginSentence(origin: VivierOrigin): string {
  const date = formatFrDate(origin.cvDate);
  if (origin.cvDateKind === 'application') {
    const job = origin.previousJobTitle ? ` pour le poste de ${origin.previousJobTitle}` : '';
    return `Vous nous aviez adressé votre candidature le ${date}${job}, et nous avons conservé votre profil.`;
  }
  return `Votre CV figure dans notre vivier de candidats depuis le ${date}.`;
}
