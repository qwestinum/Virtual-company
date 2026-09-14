/**
 * Récence de présélection par campagne (worklist vivier) — helpers PURS.
 *
 * La récence = max(generated_at) des lignes `identified` d'une campagne. Les
 * compteurs par campagne sont DÉJÀ connus (RPC `vivier_pending_by_campaign`) :
 * on s'en sert pour grouper les campagnes en lots dont le volume attendu tient
 * sous le plafond PostgREST. Un lot lu en entier (moins de lignes que la
 * limite) est prouvé complet ; un lot plein (volume qui a grossi entre-temps)
 * est relu campagne par campagne en keyset — jamais un max calculé sur une
 * lecture tronquée.
 */

export type PendingCount = { campaignId: string; pendingCount: number };

/**
 * Découpe en lots, dans l'ordre d'entrée : un lot ne dépasse ni `rowBudget`
 * lignes attendues ni `maxIds` campagnes. Une campagne dont le compte dépasse
 * seul le budget forme son propre lot.
 */
export function planRecencyChunks(
  counts: readonly PendingCount[],
  rowBudget: number,
  maxIds: number,
): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let rows = 0;
  for (const c of counts) {
    const n = Math.max(0, c.pendingCount);
    if (current.length > 0 && (rows + n > rowBudget || current.length >= maxIds)) {
      out.push(current);
      current = [];
      rows = 0;
    }
    current.push(c.campaignId);
    rows += n;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Max(generated_at) par campagne — même comparaison que l'implémentation
 * d'origine (ordre des chaînes ISO renvoyées par la base).
 */
export function lastGeneratedByCampaign(
  rows: readonly { campaign_id: string; generated_at: string }[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const r of rows) {
    const cur = into.get(r.campaign_id);
    if (!cur || r.generated_at > cur) into.set(r.campaign_id, r.generated_at);
  }
  return into;
}
