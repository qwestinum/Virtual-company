'use client';

/**
 * Point d'entrée PARTAGÉ des deux flux de classement sans suite EN MASSE —
 * les trois écrans qui clôturent et la fiche qui retient passent par ici :
 *   - mode `close` : clôture de campagne → `CampaignCloseDialog` (issue,
 *     désignation du recruté, retenus non sélectionnés, dossiers ouverts,
 *     dépublication Apec) ; POST /api/campaigns/[id]/close ;
 *   - mode `go`    : après un verdict positif (poste pourvu) → `GoDismissDialog`
 *     — classer les candidatures restantes SANS clôturer, « Plus tard » possible.
 * Jamais silencieux : le récapitulatif est affiché AVANT toute action.
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
import { GoDismissDialog } from './closure/GoDismissDialog';

export function CampaignDismissFlowDialog(props: {
  campaignId: string;
  mode: 'close' | 'go';
  onCancel: () => void;
  /** Appelé après succès (clôture posée / classement fait). */
  onDone: (summary: ClosureSummary | null) => void;
}) {
  return props.mode === 'close' ? (
    <CampaignCloseDialog campaignId={props.campaignId} onCancel={props.onCancel} onDone={props.onDone} />
  ) : (
    <GoDismissDialog campaignId={props.campaignId} onCancel={props.onCancel} onDone={props.onDone} />
  );
}
