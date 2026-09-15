/**
 * Temps OUVRÉ écoulé entre deux instants — PUR.
 *
 * « Ouvré » = couvert par la grille hebdomadaire de la ressource, moins ses
 * exceptions datées, dans SON fuseau. C'est l'horloge qui compte pour juger
 * une source d'indisponibilités muette : c'est pendant ses heures ouvrées
 * qu'une personne ajoute des rendez-vous et que des réservations se prennent.
 * Une panne commencée un vendredi soir ne « vieillit » pas pendant le
 * week-end.
 *
 * Mêmes règles d'expansion que le moteur de créneaux (`slots.ts`) : les deux
 * lisent la grille de la même façon, par jour LOCAL.
 */
import { DateTime } from 'luxon';

import {
  availableRangesForDay,
  groupExceptionsByDay,
  groupRulesByWeekday,
} from './slots';
import type { AvailabilityException, WeeklyRuleInput } from './types';

/** Au-delà, le décompte s'arrête : la réponse est de toute façon « bien trop longtemps ». */
const MAX_DAYS = 366;

export function workingMinutesBetween(input: {
  from: string;
  to: string;
  timezone: string;
  rules: WeeklyRuleInput[];
  exceptions: AvailabilityException[];
}): number {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;

  const zone = input.timezone;
  const rulesByWeekday = groupRulesByWeekday(input.rules);
  const exceptionsByDay = groupExceptionsByDay(input.exceptions);

  let total = 0;
  let day = DateTime.fromMillis(fromMs, { zone }).startOf('day');
  const lastDay = DateTime.fromMillis(toMs, { zone }).startOf('day');
  for (let i = 0; day <= lastDay && i <= MAX_DAYS; i++, day = day.plus({ days: 1 })) {
    const iso = day.toISODate();
    const ranges = availableRangesForDay(
      rulesByWeekday.get(day.weekday) ?? [],
      iso ? (exceptionsByDay.get(iso) ?? []) : [],
    );
    for (const range of ranges) {
      const start = wallClockMs(day, range.start);
      const end = wallClockMs(day, range.end);
      const overlap = Math.min(end, toMs) - Math.max(start, fromMs);
      if (overlap > 0) total += overlap;
    }
  }
  return Math.floor(total / 60_000);
}

/**
 * Heure MURALE → instant. Jamais `day.plus({ minutes })` : un jour de changement
 * d'heure dure 23 ou 25 h, et 540 minutes après minuit n'y sont pas 9h00.
 */
function wallClockMs(day: DateTime, minute: number): number {
  if (minute >= 24 * 60) return day.plus({ days: 1 }).toMillis();
  return day.set({ hour: Math.floor(minute / 60), minute: minute % 60 }).toMillis();
}
