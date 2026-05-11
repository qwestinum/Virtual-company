import { beforeEach, describe, expect, it } from 'vitest';

import { useTasksStore } from '@/stores/tasks-store';
import { buildEmptyIsolatedCriteria } from '@/types/isolated-criteria';

function makeCriteria(id: string, validated = false) {
  const c = buildEmptyIsolatedCriteria(id);
  if (validated) {
    c.isComplete = true;
    c.isValidated = true;
  }
  return c;
}

describe('tasks-store', () => {
  beforeEach(() => {
    useTasksStore.getState().reset();
  });

  it('addTask derives draft status from non-validated criteria', () => {
    const t = useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-001') });
    expect(t.status).toBe('draft');
  });

  it('addTask derives active status from validated criteria', () => {
    const t = useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-002', true) });
    expect(t.status).toBe('active');
  });

  it('addTask preserves existing status when re-adding the same id', () => {
    useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-003', true) });
    useTasksStore.getState().updateStatus('TASK-2026-003', 'closed');
    // Re-add (cas du wipe).
    useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-003', true) });
    expect(useTasksStore.getState().getById('TASK-2026-003')?.status).toBe(
      'closed',
    );
  });

  it('updateStatus is a no-op for unknown ids', () => {
    useTasksStore.getState().updateStatus('TASK-NOPE', 'closed');
    expect(Object.keys(useTasksStore.getState().byId)).toHaveLength(0);
  });

  it('list returns the tasks in insertion order', () => {
    useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-A') });
    useTasksStore
      .getState()
      .addTask({ criteria: makeCriteria('TASK-2026-B') });
    expect(useTasksStore.getState().list().map((t) => t.id)).toEqual([
      'TASK-2026-A',
      'TASK-2026-B',
    ]);
  });
});
