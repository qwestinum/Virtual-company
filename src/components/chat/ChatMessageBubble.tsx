'use client';

import { Mic } from 'lucide-react';
import Image from 'next/image';

import { getAvatarColor, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

const MANAGER_ID = 'agent.manager-rh';

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isVoice = message.source === 'voice';
  const time = formatTime(message.createdAt);

  return (
    <div
      className={cn(
        'chat-msg-rise flex items-end gap-2.5',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {isUser ? <UserAvatar /> : <ManagerAvatar />}
      <div
        className={cn(
          'flex flex-col max-w-[78%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        <span className="font-display text-[11px] font-semibold text-stone-500 mb-1 px-1">
          {isUser ? 'Vous' : 'Manager RH'}
          <span className="ml-2 font-normal text-stone-400">{time}</span>
        </span>
        <div
          className={cn(
            'font-body text-[14px] leading-relaxed px-3.5 py-2.5 shadow-sm',
            isUser
              ? 'bg-stone-900 text-stone-50 rounded-2xl rounded-br-md'
              : 'bg-white text-stone-900 border border-stone-200 rounded-2xl rounded-bl-md',
          )}
        >
          {isVoice ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-60 mb-1 font-display font-semibold">
              <Mic className="h-3 w-3" /> Vocal
            </span>
          ) : null}
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
}

function ManagerAvatar() {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <div
      className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden ring-2 ring-white shadow-sm"
      style={{ backgroundColor: color }}
    >
      {url ? (
        <Image
          src={url}
          alt="Manager RH"
          fill
          sizes="32px"
          className="object-cover"
          priority={false}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-white">
          MR
        </span>
      )}
    </div>
  );
}

function UserAvatar() {
  return (
    <div
      className={cn(
        'h-8 w-8 shrink-0 rounded-full grid place-items-center',
        'bg-stone-900 text-stone-50 font-display text-[11px] font-semibold',
        'ring-2 ring-white shadow-sm',
      )}
    >
      DRH
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
