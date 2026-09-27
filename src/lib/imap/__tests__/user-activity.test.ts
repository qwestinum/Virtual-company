import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_SCHEDULER_IDLE_MS,
  isUserRequestPath,
  lastUserRequestAt,
  noteUserRequest,
  schedulerDecision,
} from '@/lib/imap/user-activity';

const T = 1_800_000_000_000;

describe('minuteur local : pause sans activité, reprise à la première requête', () => {
  afterEach(() => {
    globalThis.__imapSchedulerWake__ = undefined;
    globalThis.__orqaLastUserRequestAt__ = undefined;
  });

  it('matrice de décision', () => {
    const idle = T - LOCAL_SCHEDULER_IDLE_MS;
    expect(LOCAL_SCHEDULER_IDLE_MS).toBe(15 * 60_000);
    expect(schedulerDecision({ nowMs: T, lastUserRequestAtMs: T - 60_000, paused: false })).toBe('run');
    expect(schedulerDecision({ nowMs: T, lastUserRequestAtMs: idle, paused: false })).toBe('pause');
    expect(schedulerDecision({ nowMs: T, lastUserRequestAtMs: idle, paused: true })).toBe('skip');
    expect(schedulerDecision({ nowMs: T, lastUserRequestAtMs: T, paused: true })).toBe('resume');
  });

  it('une requête horodate ET réveille un minuteur en pause', () => {
    const wake = vi.fn();
    globalThis.__imapSchedulerWake__ = wake;
    noteUserRequest('/candidatures', T);
    expect(lastUserRequestAt()).toBe(T);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('un déclenchement automatique (cron) n’est PAS de l’activité utilisateur', () => {
    const wake = vi.fn();
    globalThis.__imapSchedulerWake__ = wake;
    expect(isUserRequestPath('/api/cron/imap-poll')).toBe(false);
    noteUserRequest('/api/cron/imap-poll', T);
    expect(lastUserRequestAt()).toBeUndefined();
    expect(wake).not.toHaveBeenCalled();
  });

  it('sans minuteur (Vercel) : horodatage seul, rien ne casse', () => {
    expect(() => noteUserRequest('/aujourdhui', T)).not.toThrow();
  });
});
