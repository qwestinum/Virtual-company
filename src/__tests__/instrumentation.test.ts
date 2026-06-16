import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduler = { ensureSchedulerStarted: vi.fn() };
vi.mock('@/lib/imap/scheduler', () => scheduler);

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

describe('instrumentation.register — démarrage du scheduler au boot', () => {
  beforeEach(() => {
    scheduler.ensureSchedulerStarted.mockReset();
  });
  afterEach(() => {
    if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  });

  it('runtime nodejs → démarre le scheduler IMAP', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('@/instrumentation');
    await register();
    expect(scheduler.ensureSchedulerStarted).toHaveBeenCalledTimes(1);
  });

  it('runtime edge → ne démarre PAS (IMAP = Node only)', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('@/instrumentation');
    await register();
    expect(scheduler.ensureSchedulerStarted).not.toHaveBeenCalled();
  });
});
