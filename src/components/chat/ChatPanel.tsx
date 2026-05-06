'use client';

import { ChevronRight, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef } from 'react';

import { CampaignHeader } from '@/components/chat/CampaignHeader';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ChatChips } from '@/components/chat/ChatChips';
import { ChatInput } from '@/components/chat/ChatInput';
import { FieldChecklist } from '@/components/chat/FieldChecklist';
import { TypingDots } from '@/components/chat/TypingDots';
import { ValidateFDPButton } from '@/components/chat/ValidateFDPButton';
import { getAvatarColor, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { postManagerChat, postTranscribe } from '@/lib/chat/api-client';
import { cn } from '@/lib/utils';
import {
  selectMessages,
  useChatStore,
  type ChatMessage,
} from '@/stores/chat-store';
import { useFdpStore } from '@/stores/fdp-store';

const MANAGER_ID = 'agent.manager-rh';

export type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const messages = useChatStore(selectMessages);
  const isSending = useChatStore((s) => s.isSending);
  const isTranscribing = useChatStore((s) => s.isTranscribing);
  const error = useChatStore((s) => s.error);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setSending = useChatStore((s) => s.setSending);
  const setTranscribing = useChatStore((s) => s.setTranscribing);
  const setError = useChatStore((s) => s.setError);
  const resetChat = useChatStore((s) => s.reset);

  const fdp = useFdpStore((s) => s.fdp);
  const createFDP = useFdpStore((s) => s.createFDP);
  const applyExtractions = useFdpStore((s) => s.applyExtractions);
  const validateFDP = useFdpStore((s) => s.validateFDP);
  const resetFdp = useFdpStore((s) => s.reset);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isSending, isTranscribing, open]);

  function handleReset() {
    resetChat();
    resetFdp();
  }

  async function sendToManager(history: ChatMessage[]) {
    setSending(true);
    setError(null);
    try {
      const turns = history
        .filter((m) => m.role === 'user' || m.role === 'manager')
        .map((m) => ({
          role: m.role as 'user' | 'manager',
          content: m.content,
        }));
      const result = await postManagerChat({
        messages: turns,
        fdp: useFdpStore.getState().fdp,
      });

      if (result.campaignId && !useFdpStore.getState().fdp) {
        createFDP(result.campaignId);
      }
      if (result.response.fieldExtractions) {
        applyExtractions(result.response.fieldExtractions);
      }

      appendMessage({
        role: 'manager',
        source: 'text',
        content: result.response.message,
        chips: result.response.chips,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Manager.');
    } finally {
      setSending(false);
    }
  }

  async function handleSendText(text: string) {
    appendMessage({ role: 'user', source: 'text', content: text });
    void sendToManager(useChatStore.getState().messages);
  }

  function handleChipSelect(option: string) {
    if (isSending || isTranscribing) return;
    void handleSendText(option);
  }

  async function handleSendVoice(audio: File) {
    setTranscribing(true);
    setError(null);
    try {
      const text = await postTranscribe(audio);
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        setError('Transcription vide.');
        return;
      }
      appendMessage({ role: 'user', source: 'voice', content: trimmed });
      void sendToManager(useChatStore.getState().messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur transcription.');
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div
      className={cn(
        'h-full w-full flex flex-col',
        'border-l border-stone-200 bg-stone-50/70 backdrop-blur-sm',
      )}
      aria-hidden={!open}
    >
      <ChatHeader onClose={onClose} onReset={handleReset} />
      {fdp ? (
        <>
          <CampaignHeader campaignId={fdp.campaignId} />
          <FieldChecklist
            fdp={fdp}
            defaultCollapsed={fdp.campaignId.startsWith('TASK-')}
          />
        </>
      ) : null}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4"
      >
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const showBelow =
            isLast &&
            message.role === 'manager' &&
            message.chips?.placement === 'below_bubble' &&
            !isSending &&
            !isTranscribing;
          return (
            <div key={message.id}>
              <ChatBubble
                message={message}
                onChipSelect={handleChipSelect}
                chipsDisabled={isSending || isTranscribing}
              />
              {showBelow && message.chips ? (
                <ChatChips
                  chips={message.chips}
                  onSelect={handleChipSelect}
                  disabled={isSending || isTranscribing}
                />
              ) : null}
            </div>
          );
        })}
        {isTranscribing ? (
          <StatusLine label="Transcription en cours…" />
        ) : null}
        {isSending ? <TypingPreview /> : null}
        {error ? (
          <p className="font-body text-[11.5px] text-red-600 px-1">{error}</p>
        ) : null}
      </div>

      {(() => {
        const last = messages[messages.length - 1];
        if (
          !last ||
          last.role !== 'manager' ||
          last.chips?.placement !== 'above_input' ||
          isSending ||
          isTranscribing
        )
          return null;
        return (
          <ChatChips
            chips={last.chips}
            onSelect={handleChipSelect}
            disabled={isSending || isTranscribing}
          />
        );
      })()}

      {fdp ? (
        <ValidateFDPButton
          campaignId={fdp.campaignId}
          isComplete={fdp.isComplete}
          isValidated={fdp.isValidated}
          disabled={isSending || isTranscribing}
          onValidate={validateFDP}
        />
      ) : null}

      <ChatInput
        disabled={isSending || isTranscribing}
        onSendText={handleSendText}
        onSendVoice={handleSendVoice}
      />
    </div>
  );
}

function ChatHeader({
  onClose,
  onReset,
}: {
  onClose: () => void;
  onReset: () => void;
}) {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 bg-white/85 backdrop-blur">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="relative h-9 w-9 shrink-0 rounded-full overflow-hidden ring-2 ring-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {url ? (
            <Image
              src={url}
              alt="Manager RH"
              fill
              sizes="36px"
              className="object-cover"
            />
          ) : null}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white"
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-stone-500">
            Conversation
          </p>
          <h2 className="font-display text-[15px] font-semibold text-stone-900 leading-tight">
            Manager RH
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <HeaderIconButton
          ariaLabel="Réinitialiser la conversation"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
        </HeaderIconButton>
        <HeaderIconButton ariaLabel="Réduire le panneau" onClick={onClose}>
          <ChevronRight className="h-4 w-4" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

function HeaderIconButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'h-8 w-8 grid place-items-center rounded-lg text-stone-500',
        'hover:bg-stone-100 hover:text-stone-900 transition-colors',
      )}
    >
      {children}
    </button>
  );
}

function TypingPreview() {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <div className="chat-msg-rise flex items-end gap-2.5">
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
          />
        ) : null}
      </div>
      <div className="flex flex-col items-start max-w-[78%]">
        <span className="font-display text-[11px] font-semibold text-stone-500 mb-1 px-1">
          Manager RH
        </span>
        <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
          <TypingDots />
        </div>
      </div>
    </div>
  );
}

function StatusLine({ label }: { label: string }) {
  return (
    <div className="font-body text-[11.5px] text-stone-500 flex items-center gap-2 px-1">
      <TypingDots />
      <span>{label}</span>
    </div>
  );
}
