/**
 * OÙ CHAQUE COMPTEUR SE POSE — extrait de `WorkspaceNav`, qui en était le seul
 * lecteur avant que la navigation passe en colonne.
 *
 * Les badges ne changent pas de SENS, seulement de porte : la file de
 * validation vit sous « Candidatures », les prises de contact du vivier sous
 * « Campagnes ». Deux tableaux parallèles finiraient par diverger, et la
 * divergence serait muette — un badge posé sur une entrée qui ne mène nulle
 * part ne fait rougir aucun compilateur.
 *
 * Fonctions PURES : aucun rendu, aucun accès réseau.
 */

import type { WorkspaceEntryId } from '@/lib/navigation/workspace-routes';

export type WorkspaceNavBadges = {
  /** Volume : combien de dossiers attendent une décision. */
  pendingValidations: number;
  /**
   * Volume : profils du vivier qui attendent une décision. Posé sur
   * « Campagnes » depuis que la file différée a disparu — la décision se prend
   * dans la recherche vivier d'une campagne, donc c'est là qu'on envoie.
   */
  pendingVivier: number;
  /** Signal « ça traîne » : dossiers en attente depuis trop longtemps. */
  overdueValidations: number;
  /** Signal : entretiens réalisés sans verdict. */
  interviewsAwaiting: number;
  /** Signal : entretiens passés jamais pointés. */
  interviewsToPoint: number;
};

/** Où chaque compteur se pose, maintenant que les onglets ont fusionné. */
export function badgesFor(
  id: WorkspaceEntryId,
  b: WorkspaceNavBadges,
): { count: number; tone: 'volume' | 'vivier'; title: string }[] {
  const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);
  switch (id) {
    case 'candidatures':
      return b.pendingValidations > 0
        ? [
            {
              count: b.pendingValidations,
              tone: 'volume' as const,
              title: `${b.pendingValidations} ${plural(b.pendingValidations, 'candidature à valider', 'candidatures à valider')}`,
            },
          ]
        : [];
    case 'campagnes':
      return b.pendingVivier > 0
        ? [
            {
              count: b.pendingVivier,
              tone: 'vivier' as const,
              title: `${b.pendingVivier} ${plural(b.pendingVivier, 'profil du vivier à examiner', 'profils du vivier à examiner')}`,
            },
          ]
        : [];
    default:
      return [];
  }
}

/** Signal « ça traîne » (ambre), distinct du volume. */
export function overdueFor(id: WorkspaceEntryId, b: WorkspaceNavBadges) {
  const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);
  if (id === 'candidatures') {
    const n = b.overdueValidations + b.interviewsAwaiting;
    if (n === 0) return null;
    const parts = [
      b.overdueValidations > 0
        ? `${b.overdueValidations} ${plural(b.overdueValidations, 'dossier attend', 'dossiers attendent')} depuis trop longtemps`
        : null,
      b.interviewsAwaiting > 0
        ? `${b.interviewsAwaiting} ${plural(b.interviewsAwaiting, 'entretien réalisé sans verdict', 'entretiens réalisés sans verdict')}`
        : null,
    ].filter(Boolean);
    return { count: n, title: parts.join(' · ') };
  }
  if (id === 'entretiens' && b.interviewsToPoint > 0) {
    return {
      count: b.interviewsToPoint,
      title: `${b.interviewsToPoint} ${plural(b.interviewsToPoint, 'entretien passé sans pointage', 'entretiens passés sans pointage')}`,
    };
  }
  return null;
}

