/**
 * État montré au recruteur dans « Agenda externe ». PUR.
 *
 * Il s'appuie sur la copie en base et sur l'évaluation partagée avec le
 * signal (`evaluate.ts`) : l'écran dit exactement ce que le signal dit.
 */
import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';
import type { BusyCalendarStatus } from '@/types/busy-calendar';

import { busyFailureAction } from './state';

const DAY_MS = 86_400_000;

export function buildBusyCalendarStatus(input: {
  available: boolean;
  configured: boolean;
  providerLabel: string | null;
  snapshot: BusySnapshot | null;
  /** État évalué (null ⇒ jamais lu). */
  evaluatedState: 'healthy' | 'tolerated' | 'blocked' | null;
  nowMs: number;
}): BusyCalendarStatus {
  const { snapshot } = input;
  const base = {
    available: input.available,
    configured: input.configured,
    providerLabel: input.configured ? input.providerLabel : null,
  };
  if (!input.configured) {
    return { ...base, state: 'unconfigured', readAt: null, failingSince: null, upcomingCount: null, action: null };
  }

  const read = snapshot?.readAt ?? null;
  const failingSince = snapshot?.failingSince ?? null;
  if (!read && !failingSince) {
    return { ...base, state: 'pending', readAt: null, failingSince: null, upcomingCount: null, action: null };
  }

  const end = input.nowMs + 30 * DAY_MS;
  const upcomingCount = read
    ? (snapshot?.intervals ?? []).filter((i) => Date.parse(i.endAt) > input.nowMs && Date.parse(i.startAt) < end).length
    : null;
  const state = input.evaluatedState ?? (failingSince ? 'blocked' : 'healthy');
  return {
    ...base,
    state,
    readAt: read,
    failingSince,
    upcomingCount,
    action: state === 'healthy' ? null : busyFailureAction(snapshot?.failureCode ?? null),
  };
}

export function providerLabelOf(provider: string | null): string | null {
  return provider === 'microsoft' ? 'Outlook' : provider === 'google' ? 'Google' : null;
}
