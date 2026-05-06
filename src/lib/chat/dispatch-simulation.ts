/**
 * ============================================================================
 * DEAD CODE — neutralisé pour la Session 3.
 * ============================================================================
 *
 * Cette simulation faisait clignoter les cartes d'agents (CV Analyzer, Job
 * Writer, etc.) quand le Manager émettait un dispatch. Elle dépend des
 * agents exécutants, qui sont OUT du périmètre Session 3 (cf. brief
 * Session 3 — Périmètre OUT : « Implémentation réelle des autres agents …
 * Ils existent dans le store comme cartes statiques mais ne sont pas
 * exécutables en Session 3 »).
 *
 * Aucun consommateur actif après la refonte du panel chat. Le type
 * `DispatchedTask` est défini localement ici pour rester auto-suffisant —
 * l'ancien export de chat-store a été retiré dans la Session 3.
 *
 * Réactivation prévue : Session 4 — implémentation réelle du CV Analyzer
 * puis recâblage côté Manager pour produire un véritable
 * dispatch (et non une simulation visuelle). Si Session 4 maintient une
 * étape de feedback visuel, ce module pourra servir de point de départ ;
 * sinon, il sera remplacé par l'orchestration réelle.
 */

import { useAgentsStore } from '@/stores/agents-store';

export type DispatchedTask = {
  agentId: string;
  taskId: string;
  summary: string;
};

export const SIMULATED_DISPATCH_DURATION_MS = 6_000;

export function simulateDispatch(
  dispatched: DispatchedTask[],
  durationMs: number = SIMULATED_DISPATCH_DURATION_MS,
): void {
  const store = useAgentsStore.getState();

  for (const task of dispatched) {
    const agent = store.agents[task.agentId];
    if (!agent) continue;

    store.markAgentBusy(task.agentId, task.taskId);
    store.setAgentStatus(task.agentId, 'active');
    store.pushEvent({
      agentId: task.agentId,
      type: 'task_started',
      payload: { taskId: task.taskId, summary: task.summary },
    });

    window.setTimeout(() => {
      const current = useAgentsStore.getState();
      current.markAgentIdle(task.agentId);
      current.setAgentStatus(task.agentId, 'idle');
      current.pushEvent({
        agentId: task.agentId,
        type: 'task_completed',
        payload: { taskId: task.taskId },
      });
    }, durationMs);
  }
}
