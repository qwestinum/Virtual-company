/**
 * Génération d'identifiants de campagne (Session 6 v2).
 *
 * Format `CAMP-YYYY-NNN` aligné sur le générateur déjà utilisé dans
 * `manager-flow.consumeNewCampaignName`. Pour la création hors chat
 * via le dashboard, on garde le même format pour ne pas créer de
 * divergence d'identifiants entre les deux entrées.
 */

const TAKEN_THIS_SESSION = new Set<string>();

export function generateCampaignId(takenIds: Iterable<string> = []): string {
  for (const id of takenIds) TAKEN_THIS_SESSION.add(id);
  const year = new Date().getFullYear();
  // Boucle bornée pour éviter une collision théorique en démo.
  for (let attempt = 0; attempt < 50; attempt++) {
    const n = Math.floor(Math.random() * 999) + 1;
    const id = `CAMP-${year}-${String(n).padStart(3, '0')}`;
    if (!TAKEN_THIS_SESSION.has(id)) {
      TAKEN_THIS_SESSION.add(id);
      return id;
    }
  }
  // Fallback déterministe si la session a déjà brûlé tous les numéros.
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `CAMP-${year}-${stamp}`;
}
