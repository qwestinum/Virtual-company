/**
 * Navigation par semaine — PURE.
 *
 * On raisonne en JOURS LOCAUX (`YYYY-MM-DD` dans le fuseau affiché), pas en
 * instants : une semaine est ce que la personne voit sur son calendrier, pas
 * une tranche de 168 heures à partir d'un instant.
 *
 * La fenêtre demandée au serveur déborde volontairement d'un jour de chaque
 * côté, puis on filtre sur les jours réellement voulus. Ce détour évite toute
 * conversion heure-murale → instant côté navigateur : le sur-coût est nul (le
 * moteur borne déjà par le préavis et l'horizon) et le risque d'erreur d'un
 * jour disparaît.
 */
import { dayKey } from '../format';
import type { Slot } from '../types';

const DAY_MS = 86_400_000;

/** Les 7 clés de jour de la semaine (lundi → dimanche) contenant `dayIso`. */
export function weekDayKeys(dayIso: string): string[] {
  const base = Date.parse(`${dayIso}T12:00:00Z`);
  const weekday = new Date(base).getUTCDay(); // 0 = dimanche
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = base + mondayOffset * DAY_MS;
  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday + index * DAY_MS).toISOString().slice(0, 10),
  );
}

/** Semaine suivante / précédente, à partir de n'importe quel jour de la semaine. */
export function shiftWeek(dayIso: string, weeks: number): string {
  return new Date(Date.parse(`${dayIso}T12:00:00Z`) + weeks * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Fenêtre à demander au serveur : la semaine, élargie d'un jour de chaque côté. */
export function weekWindow(days: string[]): { from: string; to: string } {
  const first = days[0] as string;
  const last = days[days.length - 1] as string;
  return {
    from: new Date(Date.parse(`${first}T00:00:00Z`) - DAY_MS).toISOString(),
    to: new Date(Date.parse(`${last}T23:59:59Z`) + DAY_MS).toISOString(),
  };
}

/** Ne garde que les créneaux qui tombent vraiment dans la semaine affichée. */
export function slotsWithinWeek(
  slots: Slot[],
  days: string[],
  timeZone: string,
): Slot[] {
  const wanted = new Set(days);
  return slots.filter((slot) => wanted.has(dayKey(slot.startAt, timeZone)));
}

/** Jour local d'aujourd'hui dans le fuseau affiché. */
export function todayKey(timeZone: string): string {
  return dayKey(new Date().toISOString(), timeZone);
}
