import { create } from 'zustand';

import {
  getAgentDataSnapshot,
  getAgentOrder,
} from '@/lib/agents/registry';
import type {
  AgentContractData,
  AgentStatus,
  HumanValidation,
} from '@/types/agent';

const MAX_EVENTS = 200;

export type AgentEventType =
  | 'status_changed'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'validation_requested';

export type AgentEvent = {
  id: string;
  agentId: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AgentsState = {
  agents: Record<string, AgentContractData>;
  agentOrder: string[];
  activeTaskByAgent: Record<string, string | null>;
  events: AgentEvent[];
  selectedAgentId: string | null;

  setAgentStatus: (id: string, status: AgentStatus) => void;
  toggleAgentEnabled: (id: string) => void;
  updateHumanValidation: (id: string, patch: Partial<HumanValidation>) => void;
  markAgentBusy: (id: string, taskId: string) => void;
  markAgentIdle: (id: string) => void;
  pushEvent: (event: Omit<AgentEvent, 'id' | 'createdAt'>) => void;
  clearEvents: () => void;
  selectAgent: (id: string | null) => void;
  resetToRegistry: () => void;
};

function buildInitialState(): Pick<
  AgentsState,
  'agents' | 'agentOrder' | 'activeTaskByAgent' | 'events' | 'selectedAgentId'
> {
  const agents = getAgentDataSnapshot();
  const agentOrder = getAgentOrder();
  const activeTaskByAgent: Record<string, string | null> = {};
  for (const id of agentOrder) {
    activeTaskByAgent[id] = null;
  }
  return {
    agents,
    agentOrder,
    activeTaskByAgent,
    events: [],
    selectedAgentId: null,
  };
}

function generateEventId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useAgentsStore = create<AgentsState>()((set) => ({
  ...buildInitialState(),

  setAgentStatus: (id, status) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      const updatedAgent: AgentContractData = { ...agent, status };
      const event: AgentEvent = {
        id: generateEventId(),
        agentId: id,
        type: 'status_changed',
        payload: { status, previous: agent.status },
        createdAt: new Date().toISOString(),
      };
      const events = [...state.events, event].slice(-MAX_EVENTS);
      return {
        ...state,
        agents: { ...state.agents, [id]: updatedAgent },
        events,
      };
    }),

  toggleAgentEnabled: (id) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      const updatedAgent: AgentContractData = {
        ...agent,
        enabled: !agent.enabled,
      };
      return {
        ...state,
        agents: { ...state.agents, [id]: updatedAgent },
      };
    }),

  updateHumanValidation: (id, patch) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      const updatedAgent: AgentContractData = {
        ...agent,
        humanValidation: { ...agent.humanValidation, ...patch },
      };
      return {
        ...state,
        agents: { ...state.agents, [id]: updatedAgent },
      };
    }),

  markAgentBusy: (id, taskId) =>
    set((state) => {
      if (!state.agents[id]) return state;
      return {
        ...state,
        activeTaskByAgent: { ...state.activeTaskByAgent, [id]: taskId },
      };
    }),

  markAgentIdle: (id) =>
    set((state) => {
      if (!state.agents[id]) return state;
      return {
        ...state,
        activeTaskByAgent: { ...state.activeTaskByAgent, [id]: null },
      };
    }),

  pushEvent: (event) =>
    set((state) => {
      const full: AgentEvent = {
        ...event,
        id: generateEventId(),
        createdAt: new Date().toISOString(),
      };
      return { ...state, events: [...state.events, full].slice(-MAX_EVENTS) };
    }),

  clearEvents: () => set((state) => ({ ...state, events: [] })),

  selectAgent: (id) =>
    set((state) => {
      if (id !== null && !state.agents[id]) return state;
      return { ...state, selectedAgentId: id };
    }),

  resetToRegistry: () => set((state) => ({ ...state, ...buildInitialState() })),
}));

export const selectAgents = (state: AgentsState): AgentContractData[] =>
  state.agentOrder
    .map((id) => state.agents[id])
    .filter((a): a is AgentContractData => Boolean(a));

export const selectAgentById = (id: string) =>
  (state: AgentsState): AgentContractData | undefined => state.agents[id];

export const selectEvents = (state: AgentsState): AgentEvent[] => state.events;

export const selectSelectedAgent = (
  state: AgentsState,
): AgentContractData | null =>
  state.selectedAgentId ? state.agents[state.selectedAgentId] ?? null : null;
