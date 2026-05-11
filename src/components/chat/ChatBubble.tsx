'use client';

import { Mic } from 'lucide-react';
import Image from 'next/image';

import { AttachmentChip } from '@/components/chat/AttachmentChip';
import { CampaignPicker } from '@/components/chat/CampaignPicker';
import { ChatChips } from '@/components/chat/ChatChips';
import { CVBatchSummaryBlock } from '@/components/chat/CVBatchSummaryBlock';
import { CVProgressBlock } from '@/components/chat/CVProgressBlock';
import { CVRoutePicker } from '@/components/chat/CVRoutePicker';
import { CVSourcesPicker } from '@/components/chat/CVSourcesPicker';
import { parseMessageToBlocks } from '@/components/chat/chat-message-renderer';
import { PublicationChannelPicker } from '@/components/chat/PublicationChannelPicker';
import { ScoringSheetEditor } from '@/components/chat/ScoringSheetEditor';
import type { CVSource } from '@/types/cv-source';
import type { PublicationChannel } from '@/types/publication-channel';
import type {
  ScoringCriterion,
  ScoringLevel,
  ScoringSheet,
} from '@/types/scoring';
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
  onRoutePick?: (
    pendingId: string,
    route: 'new' | 'existing' | 'isolated',
  ) => void;
  onCampaignPick?: (pendingId: string, campaignId: string) => void;
  onChannelToggle?: (messageId: string, channel: PublicationChannel) => void;
  onChannelsConfirm?: (messageId: string) => void;
  onSourceToggle?: (messageId: string, source: CVSource) => void;
  onSourcesConfirm?: (messageId: string) => void;
  scoringSheet?: ScoringSheet | null;
  onScoringAdd?: (input: { label: string; level: ScoringLevel }) => void;
  onScoringUpdate?: (
    id: string,
    patch: Partial<Pick<ScoringCriterion, 'label' | 'level' | 'weight'>>,
  ) => void;
  onScoringRemove?: (id: string) => void;
  onScoringValidate?: (messageId: string) => void;
  blocksDisabled?: boolean;
};

export function ChatBubble({
  message,
  showInlineChips = true,
  onChipSelect,
  chipsDisabled,
  onRoutePick,
  onCampaignPick,
  onChannelToggle,
  onChannelsConfirm,
  onSourceToggle,
  onSourcesConfirm,
  scoringSheet,
  onScoringAdd,
  onScoringUpdate,
  onScoringRemove,
  onScoringValidate,
  blocksDisabled,
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
          {/*
            Round 3 — l'attachment (livrable produit) est rendu AVANT
            les blocks (actions/widgets de pilotage). Logique narrative :
            « voici ce que j'ai produit » → « voici ce qu'on fait
            maintenant ». Sans ça le picker de canaux écrasait
            visuellement la fiche de poste tout juste validée.
          */}
          {message.attachment ? (
            <AttachmentChip
              attachment={message.attachment}
              disabled={blocksDisabled}
            />
          ) : null}
          {message.block?.kind === 'scoring-sheet-editor' &&
          scoringSheet &&
          scoringSheet.campaignId === message.block.campaignId &&
          onScoringAdd &&
          onScoringUpdate &&
          onScoringRemove &&
          onScoringValidate ? (
            <ScoringSheetEditor
              sheet={scoringSheet}
              confirmed={message.block.confirmed}
              disabled={blocksDisabled}
              onAddCriterion={onScoringAdd}
              onUpdateCriterion={onScoringUpdate}
              onRemoveCriterion={onScoringRemove}
              onValidate={() => onScoringValidate(message.id)}
            />
          ) : null}
          {message.block?.kind === 'cv-sources-picker' &&
          onSourceToggle &&
          onSourcesConfirm ? (
            <CVSourcesPicker
              campaignId={message.block.campaignId}
              activeSources={message.block.activeSources}
              confirmed={message.block.confirmed}
              disabled={blocksDisabled}
              onToggle={(source) => onSourceToggle(message.id, source)}
              onConfirm={() => onSourcesConfirm(message.id)}
            />
          ) : null}
          {message.block?.kind === 'cv-route-picker' && onRoutePick ? (
            <CVRoutePicker
              pendingId={message.block.pendingId}
              fileCount={message.block.fileCount}
              activeCampaigns={message.block.activeCampaigns}
              selected={message.block.selected}
              disabled={blocksDisabled}
              onPick={onRoutePick}
            />
          ) : null}
          {message.block?.kind === 'campaign-picker' && onCampaignPick ? (
            <CampaignPicker
              pendingId={message.block.pendingId}
              campaigns={message.block.campaigns}
              selectedCampaignId={message.block.selectedCampaignId}
              disabled={blocksDisabled}
              onPick={onCampaignPick}
            />
          ) : null}
          {message.block?.kind === 'cv-progress' ? (
            <CVProgressBlock
              processed={message.block.processed}
              total={message.block.total}
            />
          ) : null}
          {message.block?.kind === 'cv-batch-summary' ? (
            <CVBatchSummaryBlock summary={message.block.summary} />
          ) : null}
          {message.block?.kind === 'publication-channel-picker' &&
          onChannelToggle &&
          onChannelsConfirm ? (
            <PublicationChannelPicker
              campaignId={message.block.campaignId}
              selectedChannels={message.block.selectedChannels}
              confirmed={message.block.confirmed}
              disabled={blocksDisabled}
              onToggle={(channel) => onChannelToggle(message.id, channel)}
              onConfirm={() => onChannelsConfirm(message.id)}
            />
          ) : null}
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
              <li
                key={i}
                className="leading-snug pl-1"
                style={
                  item.level > 0
                    ? { marginLeft: `${item.level * 18}px` }
                    : undefined
                }
              >
                {item.text}
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
