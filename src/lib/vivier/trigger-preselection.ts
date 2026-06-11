/**
 * Déclenchement client de la présélection vivier (Session V2, §4).
 *
 * Appelé à l'activation d'une campagne dont la source Vivier est cochée. POST
 * fire-and-forget vers l'endpoint IDEMPOTENT : la protection anti-doublon vit
 * côté serveur (réconciliation), pas ici — un double-clic ou une relance
 * converge sans dupliquer. Les échecs (pré-requis non réunis : 409) sont
 * silencieux ; la relance manuelle depuis le dashboard permet de retenter.
 */
export function triggerVivierPreselection(campaignId: string): void {
  void fetch(`/api/campaigns/${campaignId}/vivier-preselection`, {
    method: 'POST',
  }).catch((err) => {
    console.error('[vivier] déclenchement présélection échoué', err);
  });
}
