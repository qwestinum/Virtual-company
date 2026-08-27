/**
 * Qui est le recruteur d'une ligne de l'onglet « Entretiens » — logique PURE.
 *
 * Deux questions différentes, et les confondre a des conséquences :
 *
 *   - « En attente de réservation » : c'est le RÉFÉRENT DE LA CAMPAGNE. C'est
 *     son agenda que le candidat verra en ouvrant son lien, donc c'est lui
 *     qu'il faut nommer.
 *
 *   - « Programmés » : c'est celui qui TIENT le rendez-vous. Une réservation
 *     fige sa ressource et ne suit JAMAIS un re-pointage de la cible (règle du
 *     module de réservation). Afficher le référent actuel sur un créneau tenu
 *     par l'ancien enverrait quelqu'un au mauvais entretien.
 *
 * Quand les deux diffèrent, on le DIT (« Sami B. · référent actuel : Jane R. »)
 * plutôt que de trancher en silence : le lecteur a besoin des deux
 * informations, l'une pour se rendre au bon endroit, l'autre pour savoir à qui
 * le dossier appartient maintenant.
 */

import type { ReferentInfo } from '@/lib/referent/filter';

export type RowReferent = {
  /**
   * Le recruteur AFFICHÉ — et donc celui sur lequel le filtre porte. Cohérence
   * exigée : filtrer sur autre chose que ce qui est écrit ferait mentir
   * l'écran.
   */
  referent: ReferentInfo | null;
  /** Référent ACTUEL de la campagne, UNIQUEMENT s'il diffère de `referent`. */
  supersededBy: ReferentInfo | null;
};

/**
 * `holder` = titulaire résolu du rendez-vous (`null` pour une ligne en attente
 * de réservation, ou quand l'origine du créneau est indéterminable).
 *
 * Titulaire inconnu ⇒ on retombe sur le référent de la campagne : c'est la
 * meilleure information disponible, et c'est le comportement historique. On ne
 * fabrique pas une divergence qu'on n'a pas constatée.
 */
export function resolveRowReferent(
  campaignReferent: ReferentInfo | null,
  holder: ReferentInfo | null,
): RowReferent {
  if (!holder) return { referent: campaignReferent, supersededBy: null };
  const diverges = campaignReferent !== null && campaignReferent.id !== holder.id;
  return { referent: holder, supersededBy: diverges ? campaignReferent : null };
}

/**
 * `bookingUid → email de l'organisateur`, lu des lignes de journal du webhook
 * Cal.com (`interview_brief_delivered` / `interview_brief_regenerated`).
 *
 * En régime Cal.com il n'existe AUCUNE colonne portant le titulaire d'un
 * rendez-vous : le seul endroit où l'information est écrite est ce payload,
 * capté à la réservation. Les entrées arrivent en ordre ANTICHRONOLOGIQUE —
 * la première rencontrée pour un uid est donc la plus récente, et c'est elle
 * qui fait foi (un déplacement peut avoir changé d'agenda).
 *
 * Les lignes du chemin NATIF portent les mêmes actions sans `organizerEmail` :
 * elles sont ignorées ici, le natif ayant une source autrement plus sûre (la
 * ressource figée à la confirmation).
 */
export function organizerEmailsByBooking(
  entries: readonly { payload: Record<string, unknown> }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    const uid = entry.payload?.bookingUid;
    const email = entry.payload?.organizerEmail;
    if (typeof uid !== 'string' || typeof email !== 'string') continue;
    const normalized = email.trim().toLowerCase();
    if (normalized.length === 0 || out.has(uid)) continue;
    out.set(uid, normalized);
  }
  return out;
}
