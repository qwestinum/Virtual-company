import { describe, expect, it } from 'vitest';

import {
  AGENT_REGISTRY,
  getAgentById,
  getAgentDataSnapshot,
  getAgentOrder,
  getAgentsByDepartment,
} from '@/lib/agents/registry';
import { AgentContractDataSchema } from '@/types/agent';

describe('agent registry', () => {
  it('contains exactly 5 RH agents', () => {
    expect(AGENT_REGISTRY).toHaveLength(5);
    expect(AGENT_REGISTRY.every((a) => a.department === 'rh')).toBe(true);
  });

  it('places the manager first', () => {
    expect(AGENT_REGISTRY[0]?.id).toBe('agent.manager-rh');
  });

  it('manager is continuous, others are punctual', () => {
    const manager = getAgentById('agent.manager-rh');
    expect(manager?.trigger.type).toBe('continuous');
    const others = AGENT_REGISTRY.filter((a) => a.id !== 'agent.manager-rh');
    expect(others.every((a) => a.trigger.type === 'punctual')).toBe(true);
  });

  it('every entry passes AgentContractDataSchema', () => {
    for (const agent of AGENT_REGISTRY) {
      const { execute: _execute, ...data } = agent;
      expect(AgentContractDataSchema.safeParse(data).success).toBe(true);
    }
  });

  it('execute() throws NOT_IMPLEMENTED for unimplemented agents (Session 4 baseline)', async () => {
    const taskInput = {
      taskId: 't1',
      correlationId: 'c1',
      agentId: 'x',
      payload: {},
      context: { priority: 'normal' as const, requestedBy: 'user-1' },
    };
    // En Session 4, Job Writer et CV Analyzer sont implémentés et
    // lancent leurs propres erreurs typées sur payload invalide. Les
    // autres agents (Manager, Mail Composer, Scheduler) restent stubs.
    const stillStubbed = AGENT_REGISTRY.filter(
      (a) =>
        a.id !== 'agent.cv-analyzer' && a.id !== 'agent.job-writer',
    );
    for (const agent of stillStubbed) {
      await expect(agent.execute(taskInput)).rejects.toThrow('NOT_IMPLEMENTED');
    }
  });

  it('getAgentById returns undefined for unknown id', () => {
    expect(getAgentById('nope')).toBeUndefined();
  });

  it('getAgentsByDepartment("rh") returns all 5', () => {
    expect(getAgentsByDepartment('rh')).toHaveLength(5);
  });

  it('getAgentsByDepartment("finance") returns []', () => {
    expect(getAgentsByDepartment('finance')).toEqual([]);
  });

  it('snapshot omits execute and indexes by id', () => {
    const snap = getAgentDataSnapshot();
    expect(Object.keys(snap)).toHaveLength(5);
    expect(snap['agent.manager-rh']).toBeDefined();
    expect((snap['agent.manager-rh'] as unknown as { execute?: unknown }).execute).toBeUndefined();
  });

  it('getAgentOrder is stable and matches registry', () => {
    expect(getAgentOrder()).toEqual(AGENT_REGISTRY.map((a) => a.id));
  });
});
