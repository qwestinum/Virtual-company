/**
 * OÙ CHAQUE COMPTEUR SE POSE — extrait de `WorkspaceNav`, qui en était le seul
 * lecteur avant que la navigation passe en colonne.
 *
 * Les badges ne changent pas de SENS, seulement de porte : la file de
 * validation vit sous « Candidatures ». Deux tableaux parallèles finiraient
 * par diverger, et la divergence serait muette — un badge posé sur une entrée
 * qui ne mène nulle part ne fait rougir aucun compilateur.
 *
 * ⚠️ RETIRÉ le 22/09/2026 : le compteur des prises de contact du vivier, qui
 * vivait sous « Campagnes ». Il ne servait plus (demande du donneur d'ordre)
 * et il ne s'éteignait pas de lui-même — son décompte ignorait l'état de la
 * campagne, donc un profil présélectionné sur une campagne clôturée le tenait
 * allumé pour toujours. La file elle-même reste à `/validations-vivier`.
 *
 * Fonctions PURES : aucun rendu, aucun accès réseau.
 */

import type { WorkspaceEntryId } from '@/lib/navigation/workspace-routes';

export type WorkspaceNavBadges = {
  /** Volume : combien de dossiers attendent une décision. */
  pendingValidations: number;
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
): { count: number; tone: 'volume'; title: string }[] {
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

