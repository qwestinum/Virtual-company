'use client';

import { getAvatarColor } from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import type { AgentContractData } from '@/types/agent';

type FlowLinesProps = {
  manager: AgentContractData | null;
  others: AgentContractData[];
  unit: number;
  width: number;
  height: number;
};

export function FlowLines({
  manager,
  others,
  unit,
  width,
  height,
}: FlowLinesProps) {
  if (!manager || width <= 0 || height <= 0) return null;

  const [mx, , mz] = manager.avatar.position;
  const managerColor = getAvatarColor(manager.id);
  const cx = width / 2;
  const cy = height / 2;
  const x1 = cx + mx * unit;
  const y1 = cy + mz * unit;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      width={width}
      height={height}
      aria-hidden
    >
      <defs>
        {others.map((agent) => {
          const accent = getAvatarColor(agent.id);
          const [x, , z] = agent.avatar.position;
          const x2 = cx + x * unit;
          const y2 = cy + z * unit;
          return (
            <linearGradient
              key={agent.id}
              id={`flow-grad-${agent.id}`}
              gradientUnits="userSpaceOnUse"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            >
              <stop offset="0%" stopColor={managerColor} stopOpacity="0.85" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.95" />
            </linearGradient>
          );
        })}
      </defs>

      {others.map((agent) => {
        const [x, , z] = agent.avatar.position;
        const isActive = agent.status === 'active';
        const accent = getAvatarColor(agent.id);
        const x2 = cx + x * unit;
        const y2 = cy + z * unit;

        return (
          <g key={agent.id}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={`url(#flow-grad-${agent.id})`}
              strokeWidth={isActive ? 3 : 2}
              strokeDasharray={isActive ? '8 4' : '4 7'}
              strokeLinecap="round"
              className={cn(isActive ? 'flow-line-active' : 'flow-line')}
              opacity={isActive ? 1 : 0.7}
            />
            {isActive ? (
              <circle
                cx={x2}
                cy={y2}
                r={6}
                fill={accent}
                opacity={0.45}
                className="flow-pulse"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
