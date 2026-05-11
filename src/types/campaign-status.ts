/**
 * États possibles d'une campagne ou d'une tâche isolée (Phase 5.1).
 *
 *   - draft       : la FDP n'est pas encore validée. Collecte en cours.
 *   - in_progress : la FDP est validée mais le cadrage en aval (annonces
 *                   publiées, flux configurés, fiche de scoring validée)
 *                   n'est pas terminé.
 *   - active      : tout est validé. La campagne attend ses CV pour
 *                   passer en mode opérationnel.
 *   - closed      : besoin abandonné ou satisfait — fermée explicitement
 *                   par le DRH.
 *
 * Les transitions sont systématiquement déclenchées par le DRH via
 * une action explicite ou par la complétion d'une étape (validate FDP
 * → in_progress, validate scoring sheet → active, bouton "Clôturer" →
 * closed). Pas de descente automatique de state — quand un critère
 * d'état change après coup (fiche de scoring re-éditée par exemple),
 * c'est la responsabilité du flow appelant de redescendre le state.
 */

import { z } from 'zod';

export const CAMPAIGN_STATUSES = [
  'draft',
  'in_progress',
  'active',
  'closed',
] as const;

export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  active: 'Active',
  closed: 'Terminée',
};

/**
 * Couleurs sémantiques :
 *   - draft       : amber (en cours de cadrage, pas encore validé)
 *   - in_progress : sky (cadrage validé, prochaines étapes en route)
 *   - active      : emerald (tout est aligné, prête à recevoir)
 *   - closed      : stone (fermée, neutre)
 */
export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: '#d97706', // amber-600
  in_progress: '#0284c7', // sky-600
  active: '#059669', // emerald-600
  closed: '#78716c', // stone-500
};
