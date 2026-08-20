/**
 * Helpers PURS de l'écran « disponibilités » — conversion d'heures, validation
 * d'une grille, libellés. Sortis du composant pour être testés sans rendu :
 * c'est ici que se jouent les erreurs qui produisent une grille menteuse.
 *
 * Convention du module : minutes locales depuis minuit, jour ISO 1 = lundi.
 */

export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Lundi', short: 'Lun' },
  { value: 2, label: 'Mardi', short: 'Mar' },
  { value: 3, label: 'Mercredi', short: 'Mer' },
  { value: 4, label: 'Jeudi', short: 'Jeu' },
  { value: 5, label: 'Vendredi', short: 'Ven' },
  { value: 6, label: 'Samedi', short: 'Sam' },
  { value: 7, label: 'Dimanche', short: 'Dim' },
];

export type RuleDraft = { weekday: number; startMinute: number; endMinute: number };

/** 545 → « 09:05 ». Toujours deux chiffres : un `<input type="time">` l'exige. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.trunc(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** « 09:05 » → 545. `null` si la saisie n'est pas une heure exploitable. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h > 24 || m > 59 || h * 60 + m > 1440) return null;
  return h * 60 + m;
}

/**
 * Problèmes qui rendraient la grille FAUSSE — pas des avertissements de
 * confort. Une plage inversée ou deux plages qui se chevauchent produisent des
 * créneaux que le recruteur ne comprend pas : on refuse d'enregistrer.
 */
export function validateRules(rules: RuleDraft[]): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    if (rule.endMinute <= rule.startMinute) {
      errors.push(
        `${dayLabel(rule.weekday)} : une plage doit se terminer après son début.`,
      );
    }
  }
  for (const day of WEEKDAYS) {
    const sorted = rules
      .filter((r) => r.weekday === day.value && r.endMinute > r.startMinute)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]!.startMinute < sorted[i - 1]!.endMinute) {
        errors.push(`${day.label} : deux plages se chevauchent.`);
        break;
      }
    }
  }
  return errors;
}

export function dayLabel(weekday: number): string {
  return WEEKDAYS.find((d) => d.value === weekday)?.label ?? `Jour ${weekday}`;
}

/**
 * Plage proposée quand on ajoute une ligne : à la suite de la dernière du
 * jour, sinon un début de matinée. Éviter de rendre deux fois la même plage
 * (le module refuserait le chevauchement, et l'utilisateur ne verrait qu'un
 * message d'erreur au lieu d'une ligne utile).
 */
export function nextRuleFor(weekday: number, existing: RuleDraft[]): RuleDraft {
  const sameDay = existing
    .filter((r) => r.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
  const last = sameDay[sameDay.length - 1];
  if (!last) return { weekday, startMinute: 9 * 60, endMinute: 12 * 60 };
  const start = Math.min(last.endMinute + 60, 22 * 60);
  return { weekday, startMinute: start, endMinute: Math.min(start + 180, 24 * 60) };
}

/** Compte les plages réellement offertes — sert au message « aucune plage ». */
export function totalOpenMinutes(rules: RuleDraft[]): number {
  return rules.reduce(
    (sum, r) => sum + Math.max(0, r.endMinute - r.startMinute),
    0,
  );
}
