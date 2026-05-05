'use client';

import { getAvatarColor } from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import type { AgentContractData } from '@/types/agent';

type FlowLinesProps = {
  manager: AgentContractData | null;
  others: AgentContractData[];
  unit: number;
};

export function FlowLines({ manager, others, unit }: FlowLinesProps) {
  if (!manager) return null;

  const [mx, , mz] = manager.avatar.position;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
        </marker>
      </defs>

      {others.map((agent) => {
        const [x, , z] = agent.avatar.position;
        const isActive = agent.status === 'active';
        const accent = getAvatarColor(agent.id);
        const x1 = `calc(50% + ${mx * unit}px)`;
        const y1 = `calc(50% + ${mz * unit}px)`;
        const x2 = `calc(50% + ${x * unit}px)`;
        const y2 = `calc(50% + ${z * unit}px)`;

        return (
          <line
            key={agent.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isActive ? accent : '#cbd5e1'}
            strokeWidth={isActive ? 2.5 : 1.5}
            strokeDasharray="6 6"
            strokeLinecap="round"
            markerEnd="url(#flow-arrow)"
            className={cn(isActive ? 'flow-line-active' : 'flow-line')}
            opacity={isActive ? 0.9 : 0.55}
          />
        );
      })}
    </svg>
  );
}
