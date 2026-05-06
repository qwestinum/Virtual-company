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

  const sizeClass = isManager ? 'w-48 h-48' : 'w-40 h-40';
  const avatarSize = isManager ? 72 : 56;

  const style: CSSProperties = {
    ['--glow-color' as string]: `${accent}66`,
    borderColor: accent,
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
        style={style}
        className={cn(
          'group relative bg-white rounded-full border-2',
          'shadow-sm hover:shadow-lg',
          'transition-all duration-200 ease-out',
          'hover:-translate-y-0.5',
          sizeClass,
          isSelected &&
            'ring-2 ring-cyan-500 ring-offset-2 ring-offset-stone-50',
          (isActive || isManager) && 'agent-card-active',
          !agent.enabled && 'opacity-60',
        )}
      >
        <div className="flex flex-col items-center justify-center h-full px-3">
          <div
            className="relative rounded-full overflow-hidden ring-2 ring-white shadow"
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
                className="w-full h-full flex items-center justify-center text-white font-bold text-base"
                style={{ backgroundColor: accent }}
              >
                {initials}
              </div>
            )}
          </div>

          <h3
            className={cn(
              'font-display font-semibold text-stone-900 text-center leading-tight px-1',
              isManager ? 'mt-2.5 text-[14px]' : 'mt-2 text-[13px]',
            )}
          >
            {agent.name}
          </h3>

          <div className="mt-1.5 flex items-center gap-1">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[agent.status])}
              aria-hidden
            />
            <span className="font-body text-[10px] font-medium text-stone-600">
              {STATUS_LABEL[agent.status]}
            </span>
          </div>
        </div>

        {isWorking ? (
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 shadow-lg">
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

      {isManager ? (
        <span
          className="mt-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.16em] text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          Manager
        </span>
      ) : (
        <p className="mt-2 text-[10.5px] font-body text-stone-600 text-center leading-tight max-w-[160px] line-clamp-2">
          {agent.role}
        </p>
      )}
    </div>
  );
}
