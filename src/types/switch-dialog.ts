/**
 * Types et constantes du dialogue de switch déterministe (sub-phase 1.3).
 *
 * Fichier dédié pour pouvoir être importé côté client (ManagerChat) et
 * côté serveur (lib/agents/manager.ts) sans tirer le bundle serveur.
 * Pas de zod runtime ici — c'est un payload de sortie serveur,
 * validé indirectement par la route API qui le sérialise tel quel.
 */

/**
 * Libellés canoniques des chips du dialogue de switch. Partagés
 * client/serveur pour que ManagerChat puisse intercepter les chips
 * sans dupliquer les chaînes. Conformes R2 (audio-mode.md) :
 * courts, énonçables, distincts à l'oreille.
 */
export const SWITCH_CHIP_NEW = 'Oui, nouvelle campagne';
export const SWITCH_CHIP_KEEP = 'Non, je continue';

/**
 * Payload du dialogue de switch déterministe. Quand le serveur détecte
 * que le DRH ouvre un nouveau poste alors qu'une FDP non vide existe,
 * il court-circuite le tour conversationnel LLM et renvoie ce payload
 * pour que le client puisse, sur clic des chips :
 *   - SWITCH_CHIP_NEW  : archiver la FDP courante dans campaigns-store,
 *                        reset fdp-store, créer une FDP fraîche sous
 *                        proposedCampaignId, puis relancer un tour Manager.
 *   - SWITCH_CHIP_KEEP : conserver la FDP courante, reprendre la
 *                        collecte normale au tour suivant.
 */
export type PendingSwitch = {
  proposedCampaignId: string;
  currentCampaignId: string;
  currentJobTitle: string;
  /** Renseigne le wording du dialogue (« encore en draft » vs « validée »). */
  currentStatus: 'draft' | 'validated';
};
