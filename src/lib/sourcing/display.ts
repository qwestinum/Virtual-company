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

/**
 * Durée d'un poste : « 2 ans 4 mois », « 8 mois ». Un poste en cours se mesure
 * jusqu'à aujourd'hui. `null` sans mois de début (une année seule ne dit pas la
 * durée, et l'inventer serait pire que la taire).
 */
export function durationLabel(from: string | null, to: string | null, now: Date = new Date()): string | null {
  const a = parse(from);
  if (!a || a.m === null) return null;
  const b = to === null ? { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 } : parse(to);
  if (!b || b.m === null) return null;
  // Poste terminé : bornes incluses (05/2023 – 04/2024 = 12 mois). En cours :
  // jusqu'au mois courant exclu — le même compte que « depuis » du poste actuel.
  const months = (b.y - a.y) * 12 + (b.m - a.m) + (to === null ? 0 : 1);
  if (months < 1) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years > 0 ? `${years} an${years > 1 ? 's' : ''}` : '';
  const m = rest > 0 ? `${rest} mois` : '';
  return [y, m].filter(Boolean).join(' ');
}

type Dated = { from: string | null; to: string | null };

/** Clé de tri : en cours d'abord, puis la date de fin, puis celle de début. */
const sortKey = (d: Dated): number => {
  const end = d.to === null && d.from !== null ? { y: 9999, m: 12 } : parse(d.to) ?? parse(d.from);
  const start = parse(d.from);
  return (end ? end.y * 12 + (end.m ?? 12) : 0) * 100_000 + (start ? start.y * 12 + (start.m ?? 12) : 0);
};

/** Indices du plus récent au plus ancien — STABLE, et l'indice d'origine est gardé (corrections). */
export function newestFirst<T extends Dated>(items: T[]): { item: T; index: number }[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => sortKey(y.item) - sortKey(x.item) || x.index - y.index);
}

/** Le poste en cours : sans date de fin, le plus récent. */
export function currentPositionOf<T extends Dated>(items: T[]): T | null {
  return newestFirst(items).find((e) => e.item.to === null && e.item.from !== null)?.item ?? null;
}
