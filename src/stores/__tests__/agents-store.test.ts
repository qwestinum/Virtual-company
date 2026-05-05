import { beforeEach, describe, expect, it } from 'vitest';

import {
  selectAgentById,
  selectAgents,
  selectSelectedAgent,
  useAgentsStore,
} from '@/stores/agents-store';

describe('agents-store', () => {
  beforeEach(() => {
    useAgentsStore.getState().resetToRegistry();
  });

  it('hydrates with the 5 registry agents in stable order', () => {
    const agents = selectAgents(useAgentsStore.getState());
    expect(agents).toHaveLength(5);
    expect(agents[0]?.id).toBe('agent.manager-rh');
  });

  it('initializes activeTaskByAgent to null for every agent', () => {
    const { activeTaskByAgent, agentOrder } = useAgentsStore.getState();
    for (const id of agentOrder) {
      expect(activeTaskByAgent[id]).toBeNull();
    }
  });

  it('setAgentStatus updates the right agent and pushes a status_changed event', () => {
    useAgentsStore.getState().setAgentStatus('agent.cv-analyzer', 'active');
    const state = useAgentsStore.getState();
    expect(state.agents['agent.cv-analyzer']?.status).toBe('active');
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      agentId: 'agent.cv-analyzer',
      type: 'status_changed',
      payload: { status: 'active', previous: 'idle' },
    });
  });

  it('setAgentStatus on unknown id is a no-op', () => {
    useAgentsStore.getState().setAgentStatus('nope', 'active');
    expect(useAgentsStore.getState().events).toHaveLength(0);
  });

  it('toggleAgentEnabled flips and flips back', () => {
    const id = 'agent.mail-composer';
    const initial =
      selectAgentById(id)(useAgentsStore.getState())?.enabled ?? false;
    useAgentsStore.getState().toggleAgentEnabled(id);
    expect(selectAgentById(id)(useAgentsStore.getState())?.enabled).toBe(
      !initial,
    );
    useAgentsStore.getState().toggleAgentEnabled(id);
    expect(selectAgentById(id)(useAgentsStore.getState())?.enabled).toBe(
      initial,
    );
  });

  it('updateHumanValidation merges the patch', () => {
    useAgentsStore
      .getState()
      .updateHumanValidation('agent.cv-analyzer', { enabled: true });
    const agent = selectAgentById('agent.cv-analyzer')(
      useAgentsStore.getState(),
    );
    expect(agent?.humanValidation).toEqual({ required: false, enabled: true });
  });

  it('markAgentBusy then markAgentIdle round-trips', () => {
    useAgentsStore.getState().markAgentBusy('agent.scheduler', 'task-42');
    expect(
      useAgentsStore.getState().activeTaskByAgent['agent.scheduler'],
    ).toBe('task-42');
    useAgentsStore.getState().markAgentIdle('agent.scheduler');
    expect(
      useAgentsStore.getState().activeTaskByAgent['agent.scheduler'],
    ).toBeNull();
  });

  it('pushEvent caps the events list at 200 entries', () => {
    const { pushEvent } = useAgentsStore.getState();
    for (let i = 0; i < 250; i += 1) {
      pushEvent({
        agentId: 'agent.manager-rh',
        type: 'task_started',
        payload: { i },
      });
    }
    const events = useAgentsStore.getState().events;
    expect(events).toHaveLength(200);
    expect((events[0]?.payload as { i: number }).i).toBe(50);
    expect((events[events.length - 1]?.payload as { i: number }).i).toBe(249);
  });

  it('clearEvents empties the bus', () => {
    useAgentsStore
      .getState()
      .pushEvent({ agentId: 'a', type: 'task_started', payload: {} });
    useAgentsStore.getState().clearEvents();
    expect(useAgentsStore.getState().events).toEqual([]);
  });

  it('resetToRegistry restores defaults after mutations', () => {
    useAgentsStore.getState().setAgentStatus('agent.cv-analyzer', 'active');
    useAgentsStore.getState().toggleAgentEnabled('agent.mail-composer');
    useAgentsStore.getState().selectAgent('agent.mail-composer');
    useAgentsStore.getState().resetToRegistry();
    const state = useAgentsStore.getState();
    expect(state.agents['agent.cv-analyzer']?.status).toBe('idle');
    expect(state.agents['agent.mail-composer']?.enabled).toBe(true);
    expect(state.events).toEqual([]);
    expect(state.selectedAgentId).toBeNull();
  });

  describe('selection', () => {
    it('selectAgent sets and clears selectedAgentId', () => {
      useAgentsStore.getState().selectAgent('agent.cv-analyzer');
      expect(useAgentsStore.getState().selectedAgentId).toBe('agent.cv-analyzer');
      useAgentsStore.getState().selectAgent(null);
      expect(useAgentsStore.getState().selectedAgentId).toBeNull();
    });

    it('selectAgent on unknown id is a no-op', () => {
      useAgentsStore.getState().selectAgent('agent.cv-analyzer');
      useAgentsStore.getState().selectAgent('nope');
      expect(useAgentsStore.getState().selectedAgentId).toBe('agent.cv-analyzer');
    });

    it('selectSelectedAgent returns the resolved agent or null', () => {
      expect(selectSelectedAgent(useAgentsStore.getState())).toBeNull();
      useAgentsStore.getState().selectAgent('agent.scheduler');
      const resolved = selectSelectedAgent(useAgentsStore.getState());
      expect(resolved?.id).toBe('agent.scheduler');
    });
  });
});
