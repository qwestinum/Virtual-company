/**
 * Jours fériés français — calcul PUR, aucune table à maintenir.
 *
 * Pourquoi ici et pas dans le module de réservation : `src/lib/scheduling/**`
 * ne connaît que des ressources et des fuseaux. Un calendrier national y serait
 * une règle d'un seul pays gravée dans un composant qui se veut réutilisable.
 * L'hôte calcule donc les dates et les pose comme des exceptions ORDINAIRES,
 * via l'API d'exceptions existante — le module n'apprend rien de nouveau.
 *
 * Périmètre : les 11 fériés de France MÉTROPOLITAINE. L'Alsace-Moselle en
 * compte deux de plus (Vendredi saint, 26 décembre) et l'outre-mer a les
 * siens : les ajouter sans savoir où travaille la personne bloquerait des
 * journées ouvrées à tort. Ils restent à la saisie manuelle, qui n'a pas
 * disparu.
 *
 * Rien n'est appliqué d'office : ces dates deviennent des exceptions comme les
 * autres, que le recruteur peut retirer une à une — certains cabinets
 * travaillent le 11 novembre, et le produit n'a pas à en décider.
 */

/** Un férié : jour ISO `YYYY-MM-DD` et nom d'usage. */
export type FrenchHoliday = { day: string; label: string };

const MS_PER_DAY = 86_400_000;

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Décale un jour ISO d'un nombre de jours, sans jamais toucher à un fuseau. */
export function addDays(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d) + offset * MS_PER_DAY);
  return isoDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Jour ISO de la semaine (lundi = 1 … dimanche = 7), aligné sur Luxon et sur
 * la convention `weekday` des règles hebdomadaires.
 */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Dimanche de Pâques (comput grégorien, algorithme de Meeus/Jones/Butcher).
 * Toute l'arithmétique est entière : aucune date flottante, aucun fuseau.
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDay(year, month, day);
}

/** Les 11 fériés métropolitains d'une année, triés par date. */
export function frenchHolidays(year: number): FrenchHoliday[] {
  const easter = easterSunday(year);
  return [
    { day: isoDay(year, 1, 1), label: 'Jour de l’An' },
    { day: addDays(easter, 1), label: 'Lundi de Pâques' },
    { day: isoDay(year, 5, 1), label: 'Fête du Travail' },
    { day: isoDay(year, 5, 8), label: 'Victoire 1945' },
    { day: addDays(easter, 39), label: 'Ascension' },
    { day: addDays(easter, 50), label: 'Lundi de Pentecôte' },
    { day: isoDay(year, 7, 14), label: 'Fête nationale' },
    { day: isoDay(year, 8, 15), label: 'Assomption' },
    { day: isoDay(year, 11, 1), label: 'Toussaint' },
    { day: isoDay(year, 11, 11), label: 'Armistice 1918' },
    { day: isoDay(year, 12, 25), label: 'Noël' },
  ].sort((x, y2) => x.day.localeCompare(y2.day));
}

/**
 * Fériés à proposer : à partir de `from` (inclus) et sur `years` années.
 *
 * `openWeekdays` écarte ceux qui tombent un jour NON travaillé — bloquer un
 * dimanche pour quelqu'un qui ne reçoit jamais le dimanche n'empêche rien et
 * encombre la liste. Une liste VIDE (aucune règle encore saisie) ne filtre
 * rien : mieux vaut proposer trop que de rendre le bouton muet sans raison
 * visible.
 */
export function upcomingFrenchHolidays(input: {
  from: string;
  years?: number;
  openWeekdays?: number[];
}): FrenchHoliday[] {
  const startYear = Number(input.from.slice(0, 4));
  const span = input.years ?? 2;
  const open = new Set(input.openWeekdays ?? []);
  const out: FrenchHoliday[] = [];
  for (let year = startYear; year < startYear + span; year += 1) {
    for (const holiday of frenchHolidays(year)) {
      if (holiday.day < input.from) continue;
      if (open.size > 0 && !open.has(isoWeekday(holiday.day))) continue;
      out.push(holiday);
    }
  }
  return out;
}
