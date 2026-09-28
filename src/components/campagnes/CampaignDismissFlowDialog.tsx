'use client';

/**
 * Point d'entrée PARTAGÉ de la clôture — les trois écrans qui clôturent
 * passent par ici : `CampaignCloseDialog` (issue, désignation des recrutés,
 * retenus non sélectionnés, dossiers ouverts classés sans suite,
 * dépublication Apec) ; POST /api/campaigns/[id]/close.
 * Jamais silencieux : le récapitulatif est affiché AVANT toute action.
 *
 * ⚠️ Le mode « go » (classer les candidatures restantes après un verdict
 * positif) est RETIRÉ le 28/09/2026 : un retenu n'est pas un poste pourvu.
 * Le classement des restantes appartient à la clôture.
 *
 * ── LA DÉPUBLICATION APEC EST PROPOSÉE, JAMAIS AUTOMATIQUE ──────────────────
 *
 * Retirer l'annonce d'apec.fr est une action SORTANTE et visible du public. Ce
 * projet a déjà renversé exactement cette règle pour les refus (« aucun refus
 * n'est envoyé automatiquement »), et une clôture par erreur passé les 30 jours
 * de la fenêtre de republication serait sans retour arrière. La case est donc
 * cochée par défaut — c'est presque toujours ce qu'on veut — mais le geste
 * reste celui du recruteur.
 *
 * Elle est tentée APRÈS la clôture : fermer la campagne est l'intention
 * principale, et un incident de communication avec l'Apec ne doit pas
 * l'empêcher. Si la dépublication échoue, on le DIT, et le signal métier
 * « offre en ligne sur une campagne clôturée » la rattrape.
 */

import { CampaignCloseDialog, type ClosureSummary } from './closure/CampaignCloseDialog';

export function CampaignDismissFlowDialog(props: {
  campaignId: string;
  onCancel: () => void;
  /** Appelé après succès (clôture posée). */
  onDone: (summary: ClosureSummary | null) => void;
}) {
  return <CampaignCloseDialog campaignId={props.campaignId} onCancel={props.onCancel} onDone={props.onDone} />;
}
