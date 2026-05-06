'use client';

import { Mic } from 'lucide-react';
import Image from 'next/image';

import { ChatChips } from '@/components/chat/ChatChips';
import { parseMessageToBlocks } from '@/components/chat/chat-message-renderer';
import {
  DRH_COLOR,
  DRH_INITIALS,
  getAvatarColor,
  getAvatarUrl,
} from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

const MANAGER_ID = 'agent.manager-rh';
const MANAGER_COLOR = getAvatarColor(MANAGER_ID);

export type ChatBubbleProps = {
  message: ChatMessage;
  /**
   * Si `true` et que le message a des chips inline, ils sont rendus
   * dans la bulle. Les autres placements (below_bubble, above_input)
   * sont la responsabilité du parent.
   */
  showInlineChips?: boolean;
  onChipSelect?: (option: string) => void;
  chipsDisabled?: boolean;
};

export function ChatBubble({
  message,
  showInlineChips = true,
  onChipSelect,
  chipsDisabled,
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const isVoice = message.source === 'voice';
  const time = formatTime(message.createdAt);
  const inlineChips =
    showInlineChips &&
    message.chips &&
    message.chips.placement === 'inline' &&
    onChipSelect
      ? message.chips
      : null;

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
        <span
          className="font-display text-[11px] font-semibold mb-1 px-1"
          style={{ color: isUser ? DRH_COLOR : MANAGER_COLOR }}
        >
          {isUser ? 'Vous' : 'Manager RH'}
          {time ? (
            <span className="ml-2 font-normal text-stone-400">{time}</span>
          ) : null}
        </span>
        <div
          className={cn(
            'font-body text-[14px] leading-relaxed px-3.5 py-2.5 shadow-sm',
            isUser
              ? 'text-white rounded-2xl rounded-br-md'
              : 'bg-white text-stone-900 border border-stone-200 border-l-[3px] rounded-2xl rounded-bl-md',
          )}
          style={
            isUser
              ? { backgroundColor: DRH_COLOR }
              : { borderLeftColor: MANAGER_COLOR }
          }
        >
          {isVoice ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-60 mb-1 font-display font-semibold">
              <Mic className="h-3 w-3" /> Vocal
            </span>
          ) : null}
          <RenderedContent content={message.content} />
          {inlineChips && onChipSelect ? (
            <ChatChips
              chips={inlineChips}
              onSelect={onChipSelect}
              disabled={chipsDisabled}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RenderedContent({ content }: { content: string }) {
  const blocks = parseMessageToBlocks(content);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index} className="whitespace-pre-wrap">
              {block.text}
            </p>
          );
        }
        const ListTag = block.ordered ? 'ol' : 'ul';
        return (
          <ListTag
            key={index}
            className={cn(
              'mt-1 ml-1 space-y-1 pl-4',
              block.ordered ? 'list-decimal' : 'list-disc',
            )}
          >
            {block.items.map((item, i) => (
              <li key={i} className="leading-snug pl-1">
                {item}
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

function ManagerAvatar() {
  const url = getAvatarUrl(MANAGER_ID);
  return (
    <div
      className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden ring-2 ring-white shadow-sm"
      style={{ backgroundColor: MANAGER_COLOR }}
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
        'text-white font-display text-[11px] font-semibold',
        'ring-2 ring-white shadow-sm',
      )}
      style={{ backgroundColor: DRH_COLOR }}
    >
      {DRH_INITIALS}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '';
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
