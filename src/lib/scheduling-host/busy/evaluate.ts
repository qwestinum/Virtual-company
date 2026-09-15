/**
 * État d'un agenda à partir de sa copie en base — sans le relire.
 *
 * Point UNIQUE partagé par le signal métier et l'écran du recruteur : les deux
 * doivent dire la même chose au même instant, et la même chose que ce que la
 * relève conclurait (même horloge : le temps OUVRÉ depuis la dernière lecture
 * réussie, mêmes seuils).
 */
import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';
import {
  externalBusyToleranceMinutes,
  listExceptions,
  listWeeklyRules,
  workingMinutesBetween,
  type Resource,
} from '@/lib/scheduling';

import { classifyBusyCalendarState, isBusyCalendarSignalDue } from './state';

export type StoredBusyState = {
  state: 'healthy' | 'tolerated' | 'blocked';
  workingMinutesSinceRead: number | null;
  signalDue: boolean;
};

export async function evaluateStoredBusyState(
  snapshot: BusySnapshot,
  resource: Pick<Resource, 'id' | 'externalRef' | 'timezone'>,
  nowMs: number,
): Promise<StoredBusyState> {
  const failing = snapshot.failingSince !== null;
  let minutes: number | null = null;
  if (failing && snapshot.readAt) {
    const now = new Date(nowMs).toISOString();
    const [rules, exceptions] = await Promise.all([
      listWeeklyRules(resource),
      listExceptions(resource, { from: snapshot.readAt.slice(0, 10), to: shiftDay(now, 1) }),
    ]);
    minutes = workingMinutesBetween({
      from: snapshot.readAt,
      to: now,
      timezone: resource.timezone,
      rules,
      exceptions,
    });
  }
  const reading = { failing, readAt: snapshot.readAt, workingMinutesSinceRead: minutes };
  return {
    state: classifyBusyCalendarState({ ...reading, toleranceMinutes: externalBusyToleranceMinutes() }),
    workingMinutesSinceRead: minutes,
    signalDue: isBusyCalendarSignalDue(reading),
  };
}

function shiftDay(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}
