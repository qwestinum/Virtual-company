'use client';

/**
 * Grille de créneaux — partagée par la réservation et le déplacement.
 *
 * Deux partis pris de mise en forme, tous deux dictés par le téléphone :
 *   - les jours s'empilent verticalement au lieu de former des colonnes. Une
 *     colonne par jour sur 360 px de large oblige à viser ;
 *   - rien n'est affiché tant que le fuseau n'est pas résolu côté navigateur.
 *     Un rendu serveur des heures produirait un premier affichage dans le
 *     fuseau du serveur, puis un saut — c'est-à-dire une heure fausse pendant
 *     une fraction de seconde, sur la seule information qui compte ici.
 */
import { useMemo } from 'react';

import { dayKey, formatDayHeading, formatTime, zoneLabel } from '../format';
import { fill, type SchedulingLabels } from '../labels';
import type { Slot } from '../types';

export type SlotPickerProps = {
  slots: Slot[];
  timeZone: string;
  labels: SchedulingLabels;
  selectedStartAt: string | null;
  onSelect: (slot: Slot) => void;
  loading: boolean;
};

export function SlotPicker({
  slots,
  timeZone,
  labels,
  selectedStartAt,
  onSelect,
  loading,
}: SlotPickerProps) {
  const days = useMemo(() => groupByDay(slots, timeZone), [slots, timeZone]);

  if (loading) {
    return (
      <p className="sched-note" role="status">
        {labels.loadingSlots}
      </p>
    );
  }
  if (days.length === 0) {
    return <p className="sched-note">{labels.noSlotThisWeek}</p>;
  }

  return (
    <div>
      {days.map((day) => (
        <section key={day.key}>
          <h2 className="sched-day">{formatDayHeading(day.slots[0]!.startAt, timeZone)}</h2>
          <div className="sched-slots">
            {day.slots.map((slot) => {
              const time = formatTime(slot.startAt, timeZone);
              return (
                <button
                  key={slot.startAt}
                  type="button"
                  className="sched-slot"
                  aria-pressed={slot.startAt === selectedStartAt}
                  onClick={() => onSelect(slot)}
                >
                  {time}
                  <span className="sched-sr">
                    {` ${formatDayHeading(slot.startAt, timeZone)}, ${fill(
                      labels.timezoneLabel,
                      { zone: zoneLabel(timeZone) },
                    )}`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Regroupement PAR JOUR LOCAL du fuseau affiché — jamais par jour UTC. */
function groupByDay(
  slots: Slot[],
  timeZone: string,
): { key: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dayKey(slot.startAt, timeZone);
    const list = map.get(key);
    if (list) list.push(slot);
    else map.set(key, [slot]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, slots: list }));
}
