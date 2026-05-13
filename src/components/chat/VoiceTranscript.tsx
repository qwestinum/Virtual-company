'use client';

import { Loader2, Mic, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export type VoiceTranscriptState = 'recording' | 'transcribing';

export type VoiceTranscriptProps = {
  state: VoiceTranscriptState;
  onStop?: () => void;
};

export function VoiceTranscript({ state, onStop }: VoiceTranscriptProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (state !== 'recording') return;
    const start = Date.now();
    const tick = () => setElapsedMs(Date.now() - start);
    // Reset immédiat différé (microtask) pour éviter setState synchrone
    // dans le corps de l'effet — cf. `react-hooks/set-state-in-effect`.
    queueMicrotask(tick);
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [state]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 rounded-2xl px-3 py-2.5',
        state === 'recording'
          ? 'bg-red-50 border border-red-200'
          : 'bg-stone-50 border border-stone-200',
      )}
    >
      {state === 'recording' ? (
        <>
          <span className="relative grid place-items-center h-6 w-6 shrink-0">
            <span className="absolute h-6 w-6 rounded-full bg-red-500/30 animate-ping" />
            <Mic className="h-3.5 w-3.5 text-red-600 relative" aria-hidden />
          </span>
          <span className="font-body text-[12.5px] text-stone-700 flex-1">
            Enregistrement en cours…{' '}
            <span className="tabular-nums text-stone-500">
              {formatDuration(elapsedMs)}
            </span>
          </span>
          {onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Arrêter l'enregistrement"
              className="grid place-items-center h-8 w-8 rounded-xl bg-red-500 text-white hover:bg-red-600 shadow-sm shrink-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <Loader2
            className="h-4 w-4 text-stone-500 animate-spin shrink-0"
            aria-hidden
          />
          <span className="font-body text-[12.5px] text-stone-600 flex-1">
            Transcription en cours…
          </span>
        </>
      )}
    </div>
  );
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
