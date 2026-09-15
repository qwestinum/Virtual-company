/**
 * Ce qu'une lecture d'agenda change pour le recruteur : transitions d'état au
 * journal, et un EMAIL quand ses créneaux cessent d'être proposés.
 *
 *   - Journal : `busy_calendar_state_changed` à chaque CHANGEMENT d'état, jamais
 *     à chaque lecture (1 440 lectures par jour noieraient le fil d'activité —
 *     incident du 21/08). La transition est « gagnée » en base
 *     (`claimBusyStateTransition`) : deux instances ne la tracent pas deux fois.
 *   - Email : à l'entrée en `blocked`, UN par panne (claim deux-phases sur
 *     `(busy_calendar_blocked, recruteur|début de panne, notify)`). Un blocage
 *     silencieux priverait le cabinet de rendez-vous sans que personne ne
 *     comprenne pourquoi.
 *
 * Aucun payload ne porte l'URL, un intervalle ou un message d'erreur brut.
 * Rien ici ne lève : l'observation ne doit jamais faire échouer une lecture.
 */
import {
  claimBusyStateTransition,
  type BusyCalendarState,
} from '@/lib/db/repos/busy-snapshots';
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
} from '@/lib/db/repos/imap-outreach-claims';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { sendEmail } from '@/lib/email/client';
import {
  externalBusyToleranceMinutes,
  listExceptions,
  listWeeklyRules,
  workingMinutesBetween,
} from '@/lib/scheduling';

import type { BusyReadObservation } from './provider';
import { buildBusyCalendarBlockedEmail, classifyBusyCalendarState } from './state';

export const BUSY_CALENDAR_STATE_ACTION = 'busy_calendar_state_changed';
export const BUSY_CALENDAR_CLAIM_SCOPE = 'busy_calendar_blocked';

export type BusyNotifyDeps = {
  /** URL absolue des disponibilités du recruteur (lien de l'email). */
  settingsUrl: () => string;
};

export function createBusyCalendarObserver(deps: BusyNotifyDeps) {
  return async function observe(observation: BusyReadObservation): Promise<void> {
    try {
      const state = observation.ok
        ? 'healthy'
        : classifyBusyCalendarState({
            failing: true,
            readAt: observation.previous?.readAt ?? null,
            workingMinutesSinceRead: await workingMinutesSinceRead(observation),
            toleranceMinutes: externalBusyToleranceMinutes(),
          });

      const previousState = observation.previous?.lastState ?? null;
      if (state === previousState) return;
      if (!(await claimBusyStateTransition(observation.recruiterId, state))) return;

      // Premier état connu et sain : rien ne s'est passé qui mérite une ligne.
      if (!(state === 'healthy' && previousState === null)) {
        await appendJournalEntry({
          action: BUSY_CALENDAR_STATE_ACTION,
          actor: 'system',
          payload: {
            recruiterId: observation.recruiterId,
            from: previousState,
            to: state,
            failureCode: observation.ok ? null : observation.code,
            failingSince: observation.ok ? null : observation.failingSince,
          },
        }).catch(() => undefined);
      }

      if (state === 'blocked' && !observation.ok) {
        await emailBlocked(observation, observation.code, observation.failingSince, deps);
      }
    } catch {
      // L'observation est un effet de bord : jamais une raison d'échouer.
    }
  };
}

async function workingMinutesSinceRead(observation: BusyReadObservation): Promise<number | null> {
  const readAt = observation.previous?.readAt;
  if (!readAt) return null;
  const [rules, exceptions] = await Promise.all([
    listWeeklyRules(observation.resource),
    listExceptions(observation.resource, {
      from: shiftDate(readAt, -1),
      to: shiftDate(observation.at, 1),
    }),
  ]);
  return workingMinutesBetween({
    from: readAt,
    to: observation.at,
    timezone: observation.resource.timezone,
    rules,
    exceptions,
  });
}

async function emailBlocked(
  observation: BusyReadObservation,
  failureCode: string,
  failingSince: string,
  deps: BusyNotifyDeps,
): Promise<void> {
  const recruiter = await getRecruiter(observation.recruiterId);
  if (!recruiter?.email || !recruiter.isActive) return;

  const key = {
    mailboxId: BUSY_CALENDAR_CLAIM_SCOPE,
    uid: `${observation.recruiterId}|${failingSince}`,
    mode: 'notify' as const,
  };
  if ((await claimOutreach(key)) !== 'won') return;

  try {
    const mail = buildBusyCalendarBlockedEmail({
      displayName: recruiter.displayName,
      failureCode,
      failingSince,
      timeZone: observation.resource.timezone,
      settingsUrl: deps.settingsUrl(),
    });
    const result = await sendEmail({ to: [recruiter.email], subject: mail.subject, html: mail.html });
    if (result.ok) {
      await confirmOutreachClaim(key);
    } else {
      await releaseOutreachClaim(key);
    }
    await appendJournalEntry({
      action: 'busy_calendar_blocked_email',
      actor: 'system',
      payload: {
        recruiterId: observation.recruiterId,
        failingSince,
        mailSent: result.ok,
      },
    }).catch(() => undefined);
  } catch {
    await releaseOutreachClaim(key);
  }
}

export type { BusyCalendarState };

function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}
