'use client';

import { Mic, Paperclip, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { VoiceTranscript } from '@/components/chat/VoiceTranscript';
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
  onSendText: (text: string, source: 'text' | 'voice') => Promise<void>;
  onTranscribe: (audio: File) => Promise<string>;
  /**
   * Token incrémental qui force le focus du textarea quand il change.
   * Utilisé par le parent pour reprendre la main après un clic chip
   * d'ajustement (cf. dismissLastManagerChips dans chat-store).
   */
  focusToken?: number;
  onFilesSelected?: (files: File[]) => void;
};

const ACCEPTED_FILE_TYPES = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';

type VoiceMode = 'idle' | 'recording' | 'transcribing';

export function ChatInput({
  disabled,
  onSendText,
  onTranscribe,
  focusToken,
  onFilesSelected,
}: ChatInputProps) {
  const [draft, setDraft] = useState('');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [draftFromVoice, setDraftFromVoice] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useMicRecorder();

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [draft]);

  useEffect(() => {
    if (focusToken === undefined) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusToken]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (draftFromVoice) setDraftFromVoice(false);
  }

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || disabled) return;
    const source: 'text' | 'voice' = draftFromVoice ? 'voice' : 'text';
    setDraft('');
    setDraftFromVoice(false);
    await onSendText(text, source);
  }

  async function handleStartRecord() {
    if (disabled || voiceMode !== 'idle') return;
    setVoiceError(null);
    setVoiceMode('recording');
    await recorder.start();
  }

  async function handleStopRecord() {
    if (recorder.state !== 'recording') return;
    setVoiceMode('transcribing');
    const file = await recorder.stop();
    if (!file) {
      setVoiceError(
        MIC_ERROR_LABEL[recorder.error ?? 'unknown'] ?? 'Erreur micro.',
      );
      setVoiceMode('idle');
      return;
    }
    try {
      const text = await onTranscribe(file);
      const trimmed = text.trim();
      if (!trimmed) {
        setVoiceError('Transcription vide.');
        setVoiceMode('idle');
        return;
      }
      setDraft(trimmed);
      setDraftFromVoice(true);
      setVoiceMode('idle');
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Transcription échouée.',
      );
      setVoiceMode('idle');
    }
  }

  function handleClearDraft() {
    setDraft('');
    setDraftFromVoice(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleAttachClick() {
    if (disabled || !onFilesSelected) return;
    fileInputRef.current?.click();
  }

  function handleFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    event.target.value = '';
    onFilesSelected?.(files);
  }

  const micErrorLabel = recorder.error
    ? MIC_ERROR_LABEL[recorder.error]
    : null;
  const errorLabel = voiceError ?? micErrorLabel;
  const sendDisabled =
    disabled || draft.trim().length === 0 || voiceMode !== 'idle';

  return (
    <div className="border-t border-stone-200 bg-white/85 backdrop-blur px-3 py-3">
      {errorLabel ? (
        <p className="font-body text-[11px] text-red-600 mb-1.5 px-1">
          {errorLabel}
        </p>
      ) : null}

      {voiceMode !== 'idle' ? (
        <VoiceTranscript
          state={voiceMode}
          onStop={voiceMode === 'recording' ? handleStopRecord : undefined}
        />
      ) : (
        <div
          className={cn(
            'group flex items-end gap-2 rounded-2xl border bg-white pl-3 pr-2 py-2',
            'transition-all duration-150',
            'border-stone-200 focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-200',
          )}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Décris ta demande au Manager RH"
            disabled={disabled}
            rows={1}
            className={cn(
              'font-body flex-1 resize-none bg-transparent text-[14px] leading-relaxed',
              'outline-none placeholder:text-stone-400 disabled:opacity-60 py-1',
            )}
          />
          {draftFromVoice && draft.length > 0 ? (
            <button
              type="button"
              onClick={handleClearDraft}
              aria-label="Effacer la transcription proposée"
              className="h-9 w-9 grid place-items-center rounded-xl text-stone-500 hover:bg-stone-100 shrink-0 transition-all"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          {onFilesSelected ? (
            <AttachButton disabled={disabled} onClick={handleAttachClick} />
          ) : null}
          <MicButton disabled={disabled} onClick={handleStartRecord} />
          <SendButton
            disabled={sendDisabled}
            onClick={() => void handleSubmit()}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFilesPicked}
      />

      <p
        className={cn(
          'font-body text-[10.5px] mt-1.5 px-1.5',
          draftFromVoice && draft.length > 0
            ? 'text-amber-700'
            : 'text-stone-400',
        )}
      >
        {draftFromVoice && draft.length > 0
          ? "Transcription proposée — édite si besoin avant l'envoi."
          : 'Entrée pour envoyer · Maj+Entrée pour aller à la ligne'}
      </p>
    </div>
  );
}

function MicButton({
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
      aria-label="Démarrer enregistrement"
      className={cn(
        'h-9 w-9 grid place-items-center rounded-xl shrink-0 transition-all',
        'bg-stone-100 text-stone-600 hover:bg-stone-200',
        'disabled:opacity-40 disabled:pointer-events-none',
      )}
    >
      <Mic className="h-4 w-4" aria-hidden />
    </button>
  );
}

function AttachButton({
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
      aria-label="Joindre des fichiers (CV, .pdf .txt .md)"
      title="Joindre des CV"
      className={cn(
        'h-9 w-9 grid place-items-center rounded-xl shrink-0 transition-all',
        'bg-stone-100 text-stone-600 hover:bg-stone-200',
        'disabled:opacity-40 disabled:pointer-events-none',
      )}
    >
      <Paperclip className="h-4 w-4" aria-hidden />
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
      <Send className="h-4 w-4" aria-hidden />
    </button>
  );
}
