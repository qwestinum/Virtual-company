/**
 * Formats d'affichage d'une carte de profil — PURS.
 * Les dates du moteur sont au mois (`YYYY-MM-DD` au 1er) pour les postes, à
 * l'année (`YYYY`) pour la formation.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

function parse(value: string | null): { y: number; m: number | null } | null {
  if (!value) return null;
  const full = /^(\d{4})-(\d{2})/.exec(value);
  if (full) return { y: Number(full[1]), m: Number(full[2]) };
  const year = /^(\d{4})$/.exec(value.trim());
  return year ? { y: Number(year[1]), m: null } : null;
}

const fmt = (d: { y: number; m: number | null }): string => (d.m ? `${pad(d.m)}/${d.y}` : String(d.y));

/** « 05/2023 – auj. », « 2014 – 2016 », « 09/2019 » ; `null` sans date. */
export function periodLabel(from: string | null, to: string | null): string | null {
  const a = parse(from);
  const b = parse(to);
  if (!a && !b) return null;
  if (a && to === null) return `${fmt(a)} – auj.`;
  if (a && b) return `${fmt(a)} – ${fmt(b)}`;
  return a ? fmt(a) : fmt(b!);
}

/** « depuis 2 ans 4 mois », « depuis 6 mois » ; `null` si la date manque. */
export function tenureLabel(since: string | null, now: Date = new Date()): string | null {
  const a = parse(since);
  if (!a || a.m === null) return null;
  const months = (now.getUTCFullYear() - a.y) * 12 + (now.getUTCMonth() + 1 - a.m);
  if (months < 1) return 'depuis moins d’un mois';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years > 0 ? `${years} an${years > 1 ? 's' : ''}` : '';
  const m = rest > 0 ? `${rest} mois` : '';
  return `depuis ${[y, m].filter(Boolean).join(' ')}`;
}

/** « profil indexé il y a 38 jours » ; `null` sans date lisible. */
export function indexedAgeLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  if (days === 0) return 'profil indexé aujourd’hui';
  return `profil indexé il y a ${days} jour${days > 1 ? 's' : ''}`;
}

export const SEARCH_COST_ESTIMATE_LABEL = '≈ 0,10 $';

export function usd(value: number | null): string {
  if (value === null) return 'coût non communiqué';
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} $`;
}
