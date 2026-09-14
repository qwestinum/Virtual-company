/**
 * Compteurs de la liste des campagnes Sourcing, agrégés en JS à partir de
 * lectures GROUPÉES (toutes les campagnes à la fois) — pur, testé.
 *
 * Les chiffres doivent être IDENTIQUES à ceux des comptages par campagne
 * (`countersForCampaign`) : mêmes filtres côté base, le décompte seul passe ici.
 *   - vus        = profils `to_review`/`contacted` + exclusions `declined` ;
 *   - approchés  = approches hors `revoked` ;
 *   - manifestés = approches `submitted` (sous-ensemble des précédentes) ;
 *   - dernière recherche = le `created_at` le plus récent.
 */
import type { SourcingCounters } from '@/lib/db/repos/sourcing';

export type CounterRows = {
  /** Profils déjà filtrés sur `state in (to_review, contacted)`. */
  shownProfiles: readonly { campaign_id: string }[];
  /** Exclusions déjà filtrées sur `reason = declined`. */
  declinedExclusions: readonly { campaign_id: string | null }[];
  /** Approches déjà filtrées sur `status <> revoked`. */
  approaches: readonly { campaign_id: string; status: string }[];
  searches: readonly { campaign_id: string; created_at: string }[];
};

const TS_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Instant d'un horodatage renvoyé par PostgREST, à la MICROSECONDE : `Date`
 * s'arrête à la milliseconde, et la base range bien à la microseconde.
 * `null` si le format n'est pas reconnu.
 */
function instantOf(ts: string): { ms: number; micro: number } | null {
  const m = TS_RE.exec(ts.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]!.replace(' ', 'T')}${m[3] ?? 'Z'}`);
  if (Number.isNaN(ms)) return null;
  const micro = Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
  return { ms, micro };
}

/** Comparaison chronologique de deux horodatages (repli : ordre des chaînes). */
export function compareTimestamps(a: string, b: string): number {
  const ia = instantOf(a);
  const ib = instantOf(b);
  if (!ia || !ib) return a < b ? -1 : a > b ? 1 : 0;
  if (ia.ms !== ib.ms) return ia.ms - ib.ms;
  return ia.micro - ib.micro;
}

/** Un compteur par campagne demandée, zéros compris, dans l'ordre demandé. */
export function aggregateSourcingCounters(
  campaignIds: readonly string[],
  rows: CounterRows,
): Map<string, SourcingCounters> {
  const out = new Map<string, SourcingCounters>();
  for (const id of campaignIds) {
    out.set(id, { seen: 0, approached: 0, manifested: 0, lastSearchAt: null });
  }
  for (const r of rows.shownProfiles) {
    const c = out.get(r.campaign_id);
    if (c) c.seen += 1;
  }
  for (const r of rows.declinedExclusions) {
    const c = r.campaign_id === null ? undefined : out.get(r.campaign_id);
    if (c) c.seen += 1;
  }
  for (const r of rows.approaches) {
    const c = out.get(r.campaign_id);
    if (!c) continue;
    c.approached += 1;
    if (r.status === 'submitted') c.manifested += 1;
  }
  for (const r of rows.searches) {
    const c = out.get(r.campaign_id);
    if (!c) continue;
    if (c.lastSearchAt === null || compareTimestamps(r.created_at, c.lastSearchAt) > 0) {
      c.lastSearchAt = r.created_at;
    }
  }
  return out;
}
