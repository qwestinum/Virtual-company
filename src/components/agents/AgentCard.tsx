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

  const sizeClass = isManager ? 'w-60' : 'w-52';
  const avatarSize = isManager ? 96 : 80;

  const style: CSSProperties = {
    ['--glow-color' as string]: `${accent}66`,
    borderLeftColor: accent,
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <button
      type="button"
      aria-label={`Ouvrir ${agent.name}`}
      onClick={handleClick}
      style={style}
      className={cn(
        'group relative text-left bg-white rounded-2xl border border-stone-200',
        'border-l-4 shadow-sm hover:shadow-md',
        'transition-all duration-200 ease-out',
        'hover:-translate-y-0.5',
        sizeClass,
        isSelected && 'ring-2 ring-cyan-500 ring-offset-2 ring-offset-stone-50',
        (isActive || isManager) && 'agent-card-active',
        !agent.enabled && 'opacity-60',
      )}
    >
      <div className="flex flex-col items-center px-5 pt-5 pb-4">
        <div
          className="relative rounded-full overflow-hidden ring-4 ring-white shadow"
          style={{ width: avatarSize, height: avatarSize }}
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={agent.name}
              width={avatarSize}
              height={avatarSize}
              priority={isManager}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-white font-bold text-xl"
              style={{ backgroundColor: accent }}
            >
              {initials}
            </div>
          )}
        </div>

        <h3 className="mt-3 text-base font-semibold text-stone-900 text-center">
          {agent.name}
        </h3>
        <p className="mt-1 text-xs text-stone-500 text-center line-clamp-2 min-h-[2rem]">
          {agent.role}
        </p>

        <div className="mt-3 flex items-center gap-1.5">
          <span
            className={cn('h-2 w-2 rounded-full', STATUS_DOT[agent.status])}
            aria-hidden
          />
          <span className="text-xs font-medium text-stone-600">
            {STATUS_LABEL[agent.status]}
          </span>
        </div>

        {isManager ? (
          <span
            className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: accent }}
          >
            Manager
          </span>
        ) : null}
      </div>

      {isWorking ? (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 shadow-lg">
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
  );
}
