/**
 * Sync client ↔ serveur pour `tasks-store` (Session 5, round 1).
 *
 * Symétrique de campaigns-sync.ts pour les sollicitations TASK-XXXX.
 */
'use client';

import type { ArchivedTask } from '@/stores/tasks-store';
import { useTasksStore } from '@/stores/tasks-store';

const PUSH_DEBOUNCE_MS = 300;

let hydrationStarted = false;
let isHydrating = false;
let subscriberAttached = false;
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function hydrateTasks(): Promise<{ ok: boolean; count: number }> {
  if (hydrationStarted) {
    return { ok: true, count: useTasksStore.getState().order.length };
  }
  hydrationStarted = true;

  let tasks: ArchivedTask[] = [];
  try {
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    if (res.status === 503) return { ok: false, count: 0 };
    if (!res.ok) return { ok: false, count: 0 };
    const json = (await res.json()) as { tasks: ArchivedTask[] };
    tasks = json.tasks ?? [];
  } catch {
    return { ok: false, count: 0 };
  }

  isHydrating = true;
  try {
    useTasksStore.setState((state) => {
      const byId = { ...state.byId };
      const seen = new Set<string>();
      const order: string[] = [];
      for (const incoming of tasks) {
        const local = byId[incoming.id];
        if (!(local && local.updatedAt > incoming.updatedAt)) {
          byId[incoming.id] = incoming;
        }
        seen.add(incoming.id);
        order.push(incoming.id);
      }
      for (const id of state.order) {
        if (!seen.has(id)) order.push(id);
      }
      return { ...state, byId, order };
    });
  } finally {
    isHydrating = false;
  }
  return { ok: true, count: tasks.length };
}

export function attachTasksSync(): () => void {
  if (subscriberAttached) return () => {};
  subscriberAttached = true;

  let previous = useTasksStore.getState().byId;
  const unsubscribe = useTasksStore.subscribe((state) => {
    const next = state.byId;
    if (isHydrating) {
      previous = next;
      return;
    }
    for (const id of Object.keys(next)) {
      if (previous[id] !== next[id]) {
        schedulePush(id, next[id]!);
      }
    }
    previous = next;
  });

  return () => {
    subscriberAttached = false;
    unsubscribe();
  };
}

function schedulePush(id: string, snapshot: ArchivedTask): void {
  const existing = pushTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pushTimers.delete(id);
    void pushTask(snapshot);
  }, PUSH_DEBOUNCE_MS);
  pushTimers.set(id, timer);
}

async function pushTask(snapshot: ArchivedTask): Promise<void> {
  try {
    await fetch('/api/tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      cache: 'no-store',
    });
  } catch {
    // silencieux.
  }
}

export function _resetTasksSyncForTests(): void {
  hydrationStarted = false;
  isHydrating = false;
  subscriberAttached = false;
  for (const t of pushTimers.values()) clearTimeout(t);
  pushTimers.clear();
}
