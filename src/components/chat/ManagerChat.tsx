'use client';

import { RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { isAdjustmentSignal } from '@/components/chat/adjustment-signal';

import { CampaignHeader } from '@/components/chat/CampaignHeader';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ChatChips } from '@/components/chat/ChatChips';
import { ChatInput } from '@/components/chat/ChatInput';
import { FieldChecklist } from '@/components/chat/FieldChecklist';
import { TypingDots } from '@/components/chat/TypingDots';
import { ValidateFDPButton } from '@/components/chat/ValidateFDPButton';
import { getAvatarColor, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { fdpToCVCriteria } from '@/lib/agents/fdp-to-criteria';
import { postManagerChat, postTranscribe } from '@/lib/chat/api-client';
import {
  consumePendingIsolatedTask,
  dispatchCVBatch,
  dispatchIsolatedCVTask,
  dispatchJobWriter,
  getPendingIsolatedTask,
} from '@/lib/chat/manager-flow';
import { cn } from '@/lib/utils';
import { useArtifactsStore } from '@/stores/artifacts-store';
import {
  selectMessages,
  useChatStore,
  type ChatMessage,
} from '@/stores/chat-store';
import { useFdpStore } from '@/stores/fdp-store';
import { DEFAULT_CV_THRESHOLD } from '@/types/cv-analysis';
import {
  FIELD_KEYS,
  type FDPInProgress,
} from '@/types/field-collection';

const MANAGER_ID = 'agent.manager-rh';

function countMissing(fdp: FDPInProgress): number {
  return FIELD_KEYS.filter((k) => fdp.fields[k]?.status !== 'filled').length;
}

export function ManagerChat() {
  const messages = useChatStore(selectMessages);
  const isSending = useChatStore((s) => s.isSending);
  const isTranscribing = useChatStore((s) => s.isTranscribing);
  const error = useChatStore((s) => s.error);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setSending = useChatStore((s) => s.setSending);
  const setTranscribing = useChatStore((s) => s.setTranscribing);
  const setError = useChatStore((s) => s.setError);
  const dismissLastManagerChips = useChatStore(
    (s) => s.dismissLastManagerChips,
  );
  const resetChat = useChatStore((s) => s.reset);

  const [inputFocusToken, setInputFocusToken] = useState(0);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const [openFirstMissingToken, setOpenFirstMissingToken] = useState(0);

  const fdp = useFdpStore((s) => s.fdp);
  const createFDP = useFdpStore((s) => s.createFDP);
  const applyExtractions = useFdpStore((s) => s.applyExtractions);
  const validateFDP = useFdpStore((s) => s.validateFDP);
  const resetFdp = useFdpStore((s) => s.reset);
  const resetArtifacts = useArtifactsStore((s) => s.reset);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isSending, isTranscribing]);

  function handleReset() {
    resetChat();
    resetFdp();
    resetArtifacts();
  }

  async function handleValidateFDP() {
    const current = useFdpStore.getState().fdp;
    if (!current || !current.isComplete || current.isValidated) return;
    validateFDP();
    const validated = useFdpStore.getState().fdp;
    if (!validated) return;
    setAgentBusy(true);
    try {
      await dispatchJobWriter(validated);
    } finally {
      setAgentBusy(false);
    }
  }

  function handleSourcePick(source: 'manuel') {
    if (source !== 'manuel') return;
    const last = [...useChatStore.getState().messages]
      .reverse()
      .find((m) => m.block?.kind === 'source-picker');
    if (last && last.block?.kind === 'source-picker') {
      updateMessage(last.id, {
        block: { kind: 'source-picker', selected: 'manuel' },
      });
    }
    appendMessage({
      role: 'user',
      source: 'text',
      content: 'Source : manuel.',
    });
    appendMessage({
      role: 'manager',
      source: 'text',
      content:
        "Parfait. Utilisez le trombone ci-dessous pour me téléverser un ou plusieurs CV — j'enchaîne dès qu'ils arrivent.",
    });
  }

  async function handleFilesSelected(files: File[]) {
    if (files.length === 0 || isAgentBusy) return;
    const current = useFdpStore.getState().fdp;
    const sourceSelected = lastSourcePickerSelected();

    if (current?.isValidated && sourceSelected === 'manuel') {
      const userBubble =
        files.length === 1
          ? `J'ai joint un CV : ${files[0].name}.`
          : `J'ai joint ${files.length} CV : ${files.map((f) => f.name).join(', ')}.`;
      appendMessage({ role: 'user', source: 'text', content: userBubble });
      setAgentBusy(true);
      try {
        await dispatchCVBatch({
          files,
          criteria: fdpToCVCriteria(current),
          threshold: DEFAULT_CV_THRESHOLD,
          campaignId: current.campaignId,
        });
      } finally {
        setAgentBusy(false);
      }
      return;
    }

    if (current?.isValidated && sourceSelected !== 'manuel') {
      appendMessage({
        role: 'manager',
        source: 'text',
        content:
          'Choisissez d\'abord une source dans la liste ci-dessus avant de me transmettre les CV.',
      });
      return;
    }

    // Hors campagne → tâche isolée TASK-XXXX.
    dispatchIsolatedCVTask(files);
  }

  function lastSourcePickerSelected(): 'manuel' | null {
    const list = useChatStore.getState().messages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.block?.kind === 'source-picker') {
        return m.block.selected;
      }
    }
    return null;
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

  async function handleSendText(
    text: string,
    source: 'text' | 'voice' = 'text',
  ) {
    appendMessage({ role: 'user', source, content: text });

    // Si une tâche isolée CV attend l'instruction libre du DRH, on
    // consomme sa réponse au lieu d'envoyer un tour Manager classique.
    if (getPendingIsolatedTask()) {
      setAgentBusy(true);
      try {
        await consumePendingIsolatedTask(text);
      } finally {
        setAgentBusy(false);
      }
      return;
    }

    void sendToManager(useChatStore.getState().messages);
  }

  function handleChipSelect(option: string) {
    if (isSending || isTranscribing) return;
    if (isAdjustmentSignal(option)) {
      // Pas de tour LLM : le DRH veut juste reprendre la main.
      dismissLastManagerChips();
      setInputFocusToken((token) => token + 1);
      return;
    }
    void handleSendText(option, 'text');
  }

  async function handleTranscribe(audio: File): Promise<string> {
    setTranscribing(true);
    setError(null);
    try {
      return await postTranscribe(audio);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur transcription.';
      setError(message);
      throw err;
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className="h-full w-full flex flex-col">
      <ChatHeader onReset={handleReset} />
      {fdp ? (
        <>
          <CampaignHeader campaignId={fdp.campaignId} />
          <FieldChecklist
            fdp={fdp}
            defaultCollapsed={fdp.campaignId.startsWith('TASK-')}
            editingDisabled={
              fdp.isValidated || isSending || isTranscribing || isAgentBusy
            }
            openFirstMissingToken={openFirstMissingToken}
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
                chipsDisabled={isSending || isTranscribing || isAgentBusy}
                onSourcePick={handleSourcePick}
                blocksDisabled={isSending || isTranscribing || isAgentBusy}
              />
              {showBelow && message.chips ? (
                <ChatChips
                  chips={message.chips}
                  onSelect={handleChipSelect}
                  disabled={isSending || isTranscribing || isAgentBusy}
                />
              ) : null}
            </div>
          );
        })}
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
          disabled={isSending || isTranscribing || isAgentBusy}
          onValidate={handleValidateFDP}
          missingCount={countMissing(fdp)}
          onRequestComplete={() =>
            setOpenFirstMissingToken((t) => t + 1)
          }
        />
      ) : null}

      <ChatInput
        disabled={isSending || isTranscribing || isAgentBusy}
        onSendText={handleSendText}
        onTranscribe={handleTranscribe}
        focusToken={inputFocusToken}
        onFilesSelected={handleFilesSelected}
      />
    </div>
  );
}

function ChatHeader({ onReset }: { onReset: () => void }) {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <header
      className="relative flex items-center justify-between gap-3 px-4 py-3.5 border-b border-stone-200 text-white"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="relative h-11 w-11 shrink-0 rounded-full overflow-hidden ring-2 ring-white/80 shadow-md"
          style={{ backgroundColor: color }}
        >
          {url ? (
            <Image
              src={url}
              alt="Manager RH"
              fill
              sizes="44px"
              className="object-cover"
            />
          ) : null}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white"
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-white/70 font-medium">
            Conversation
          </p>
          <h2 className="font-display text-[15px] font-semibold leading-tight">
            Manager RH
          </h2>
          <p className="font-body text-[10.5px] text-white/80 mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
            En ligne · prêt à cadrer une demande
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <HeaderIconButton
          ariaLabel="Réinitialiser la conversation"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
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
        'h-8 w-8 grid place-items-center rounded-lg text-white/85',
        'hover:bg-white/15 hover:text-white transition-colors',
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
        <span
          className="font-display text-[11px] font-semibold mb-1 px-1"
          style={{ color }}
        >
          Manager RH
        </span>
        <div
          className="bg-white border border-stone-200 border-l-[3px] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"
          style={{ borderLeftColor: color }}
        >
          <TypingDots color={color} />
        </div>
      </div>
    </div>
  );
}
