'use client';

import { Loader2, Mic, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useMicRecorder } from '@/lib/chat/use-mic-recorder';
import { cn } from '@/lib/utils';

const MIC_ERROR_LABEL: Record<string, string> = {
  unsupported: 'Microphone non supporté par ce navigateur.',
  permission_denied: 'Permission micro refusée.',
  no_data: 'Aucun audio capturé.',
  unknown: 'Erreur micro.',
};

export type ChatInputProps = {
  disabled: boolean;
  onSendText: (text: string) => Promise<void>;
  onSendVoice: (audio: File) => Promise<void>;
};

export function ChatInput({
  disabled,
  onSendText,
  onSendVoice,
}: ChatInputProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorder = useMicRecorder();
  const isRecording = recorder.state === 'recording';
  const isStopping = recorder.state === 'stopping';
  const isRequesting = recorder.state === 'requesting';
  const isMicBusy = isRequesting || isStopping;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [draft]);

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft('');
    await onSendText(text);
  }

  async function handleMicClick() {
    if (disabled && !isRecording) return;
    if (isRecording) {
      const file = await recorder.stop();
      if (file) await onSendVoice(file);
      return;
    }
    if (recorder.state === 'idle') await recorder.start();
  }

  const micErrorLabel = recorder.error ? MIC_ERROR_LABEL[recorder.error] : null;
  const sendDisabled = disabled || draft.trim().length === 0 || isRecording;

  return (
    <div className="border-t border-stone-200 bg-white/85 backdrop-blur px-3 py-3">
      {micErrorLabel ? (
        <p className="font-body text-[11px] text-red-600 mb-1.5 px-1">
          {micErrorLabel}
        </p>
      ) : null}
      <div
        className={cn(
          'group flex items-end gap-2 rounded-2xl border bg-white pl-3 pr-2 py-2',
          'transition-all duration-150',
          isRecording
            ? 'border-red-300 ring-2 ring-red-200/60'
            : 'border-stone-200 focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-200',
        )}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={
            isRecording
              ? 'Enregistrement en cours…'
              : 'Décris ta demande au Manager RH'
          }
          disabled={disabled || isRecording}
          rows={1}
          className={cn(
            'font-body flex-1 resize-none bg-transparent text-[14px] leading-relaxed',
            'outline-none placeholder:text-stone-400 disabled:opacity-60 py-1',
          )}
        />
        <MicButton
          recording={isRecording}
          busy={isMicBusy}
          disabled={disabled && !isRecording}
          onClick={handleMicClick}
        />
        <SendButton disabled={sendDisabled} onClick={() => void handleSubmit()} />
      </div>
      <p className="font-body text-[10.5px] text-stone-400 mt-1.5 px-1.5">
        Entrée pour envoyer · Maj+Entrée pour aller à la ligne
      </p>
    </div>
  );
}

function MicButton({
  recording,
  busy,
  disabled,
  onClick,
}: {
  recording: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={recording ? 'Arrêter et envoyer' : 'Démarrer enregistrement'}
      aria-pressed={recording}
      className={cn(
        'h-9 w-9 grid place-items-center rounded-xl shrink-0 transition-all',
        recording
          ? 'bg-red-500 text-white shadow-md hover:bg-red-600'
          : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
        'disabled:opacity-40 disabled:pointer-events-none',
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <Square className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

function SendButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Envoyer"
      className={cn(
        'h-9 w-9 grid place-items-center rounded-xl shrink-0 transition-all',
        'bg-stone-900 text-stone-50 hover:bg-stone-800',
        'disabled:opacity-30 disabled:pointer-events-none',
      )}
    >
      <Send className="h-4 w-4" />
    </button>
  );
}
