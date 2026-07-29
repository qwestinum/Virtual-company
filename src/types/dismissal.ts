/**
 * « Classée sans suite » — fin de vie propre d'une candidature non traitée.
 *
 * DISTINCT du refus : un refus est une décision d'ÉVALUATION (examiné →
 * rejeté) ; un classement sans suite n'est PAS une évaluation (raison
 * externe : campagne clôturée, poste pourvu, candidat retiré…). Le verdict
 * de screening (`candidate_analyses.status`) et la zone restent INTACTS —
 * le classement est une dimension orthogonale (colonnes `dismissed_*`),
 * jamais un 3ᵉ statut. Module CLIENT-SAFE (types purs).
 */

import { z } from 'zod';

export const DISMISSAL_REASONS = [
  'campagne_cloturee',
  'poste_pourvu',
  'candidat_retire',
  'sans_reponse',
  'doublon',
  'invalide',
] as const;
export const DismissalReasonSchema = z.enum(DISMISSAL_REASONS);
export type DismissalReason = z.infer<typeof DismissalReasonSchema>;

/** Libellés métier — source unique UI / PDF / journal. */
export const DISMISSAL_REASON_LABELS: Record<DismissalReason, string> = {
  campagne_cloturee: 'Campagne clôturée',
  poste_pourvu: 'Poste pourvu',
  candidat_retire: 'Candidat retiré',
  sans_reponse: 'Sans réponse',
  doublon: 'Doublon',
  invalide: 'Candidature invalide',
};

/** Raisons proposables sur l'ACTION INDIVIDUELLE (les deux premières sont
 * réservées aux flux clôture de campagne / GO). */
export const INDIVIDUAL_DISMISSAL_REASONS: DismissalReason[] = [
  'candidat_retire',
  'sans_reponse',
  'doublon',
  'invalide',
];

/**
 * Politique du mail d'information par raison (matrice validée) :
 *   - 'checked'   : mail proposé, case cochée par défaut ;
 *   - 'unchecked' : mail proposé, case décochée (le recruteur choisit) ;
 *   - 'never'     : jamais de mail, option masquée (doublon / invalide).
 */
export type DismissalMailPolicy = 'checked' | 'unchecked' | 'never';

export const DISMISSAL_MAIL_POLICY: Record<DismissalReason, DismissalMailPolicy> = {
  campagne_cloturee: 'checked',
  poste_pourvu: 'checked',
  sans_reponse: 'checked',
  candidat_retire: 'unchecked',
  doublon: 'never',
  invalide: 'never',
};

/** Un mail est-il envoyable pour cette raison (indépendamment du choix UI) ? */
export function dismissalMailAllowed(reason: DismissalReason): boolean {
  return DISMISSAL_MAIL_POLICY[reason] !== 'never';
}
