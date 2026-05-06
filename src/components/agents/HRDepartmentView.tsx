'use client';

import type { CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { selectAgents, useAgentsStore } from '@/stores/agents-store';
import type { AgentContractData } from '@/types/agent';

import { AgentCard } from './AgentCard';
import { FlowLines } from './FlowLines';

const MANAGER_ID = 'agent.manager-rh';
const UNIT = 130;

function cardStyleFor(agent: AgentContractData): CSSProperties {
  const [x, , z] = agent.avatar.position;
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(calc(-50% + ${x * UNIT}px), calc(-50% + ${z * UNIT}px))`,
  };
}

export function HRDepartmentView() {
  const agents = useAgentsStore(useShallow(selectAgents));
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const activeTaskByAgent = useAgentsStore(
    useShallow((s) => s.activeTaskByAgent),
  );
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  const manager = agents.find((a) => a.id === MANAGER_ID) ?? null;
  const others = agents.filter((a) => a.id !== MANAGER_ID);

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-grid-dots"
      onPointerDown={() => selectAgent(null)}
    >
      <header className="absolute top-6 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
        <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500 font-medium">
          Département
        </p>
        <h1 className="text-2xl font-semibold text-stone-900 mt-1">
          Ressources Humaines
        </h1>
      </header>

      <FlowLines manager={manager} others={others} unit={UNIT} />

      {agents.map((agent) => (
        <div key={agent.id} style={cardStyleFor(agent)}>
          <AgentCard
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            isManager={agent.id === MANAGER_ID}
            isWorking={Boolean(activeTaskByAgent[agent.id])}
            onSelect={selectAgent}
          />
        </div>
      ))}
    </div>
  );
}
