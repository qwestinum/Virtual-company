'use client';

import Image from 'next/image';
import type { CSSProperties, MouseEvent } from 'react';

import {
  getAvatarColor,
  getAvatarInitials,
  getAvatarUrl,
} from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import type { AgentContractData, AgentStatus } from '@/types/agent';

type AgentCardProps = {
  agent: AgentContractData;
  isSelected: boolean;
  isManager: boolean;
  isWorking: boolean;
  onSelect: (id: string) => void;
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'En attente',
  active: 'Actif',
  error: 'Erreur',
  disabled: 'Désactivé',
};

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-zinc-400',
  active: 'bg-emerald-500',
  error: 'bg-red-500',
  disabled: 'bg-zinc-300',
};

export function AgentCard({
  agent,
  isSelected,
  isManager,
  isWorking,
  onSelect,
}: AgentCardProps) {
  const accent = getAvatarColor(agent.id);
  const initials = getAvatarInitials(agent.id);
  const avatarUrl = getAvatarUrl(agent.id);
  const isActive = agent.status === 'active';

  const circleSize = isManager ? 144 : 120;

  const buttonStyle: CSSProperties = {
    ['--glow-color' as string]: `${accent}66`,
    borderColor: accent,
    width: circleSize,
    height: circleSize,
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={`Ouvrir ${agent.name}`}
        onClick={handleClick}
        style={buttonStyle}
        className={cn(
          'group relative rounded-full overflow-hidden border-[3px] bg-white',
          'shadow-md hover:shadow-xl',
          'transition-all duration-200 ease-out',
          'hover:-translate-y-0.5',
          isSelected &&
            'ring-2 ring-cyan-500 ring-offset-2 ring-offset-stone-50',
          (isActive || isManager) && 'agent-card-active',
          !agent.enabled && 'opacity-60',
        )}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={agent.name}
            fill
            sizes={`${circleSize}px`}
            priority={isManager}
            className="object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white font-bold text-2xl"
            style={{ backgroundColor: accent }}
          >
            {initials}
          </div>
        )}

        {isWorking ? (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-900/90 shadow-lg">
            <span
              className="work-dot h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <span
              className="work-dot h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <span
              className="work-dot h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: accent }}
            />
          </div>
        ) : null}
      </button>

      <h3
        className={cn(
          'mt-2.5 font-display font-semibold text-stone-900 text-center leading-tight',
          isManager ? 'text-[14px]' : 'text-[13px]',
        )}
      >
        {agent.name}
      </h3>

      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[agent.status])}
          aria-hidden
        />
        <span className="font-body text-[10.5px] font-medium text-stone-600">
          {STATUS_LABEL[agent.status]}
        </span>
      </div>
    </div>
  );
}
