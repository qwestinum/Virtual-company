import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/imap/poller', () => ({
  pollAllMailboxes: vi.fn().mockResolvedValue([]),
}));

import {
  ensureSchedulerStarted,
  getSchedulerStatus,
  stopScheduler,
} from '@/lib/imap/scheduler';

describe('imap scheduler singleton', () => {
  const prevVercel = process.env.VERCEL;
  beforeEach(() => {
    delete process.env.VERCEL; // ces tests valident le timer dev/VPS
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    vi.restoreAllMocks();
  });

  it('starts once and reports running', () => {
    const first = ensureSchedulerStarted();
    expect(first.alreadyRunning).toBe(false);
    expect(first.startedAt).toBeTruthy();

    const status = getSchedulerStatus();
    expect(status.running).toBe(true);
    expect(status.intervalMs).toBe(30_000);
  });

  it('is idempotent — second call reports alreadyRunning', () => {
    const first = ensureSchedulerStarted();
    const second = ensureSchedulerStarted();
    expect(second.alreadyRunning).toBe(true);
    expect(second.startedAt).toBe(first.startedAt);
  });

  it('stopScheduler clears the handle', () => {
    ensureSchedulerStarted();
    expect(getSchedulerStatus().running).toBe(true);
    stopScheduler();
    expect(getSchedulerStatus().running).toBe(false);
  });

  it('ne démarre PAS de timer sur Vercel (polling délégué au cron)', () => {
    process.env.VERCEL = '1';
    const res = ensureSchedulerStarted();
    expect(res.alreadyRunning).toBe(true); // no-op signalé
    expect(getSchedulerStatus().running).toBe(false); // aucun setInterval
  });
});
