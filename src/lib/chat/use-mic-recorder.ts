'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type MicRecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

export type MicRecorderError =
  | 'unsupported'
  | 'permission_denied'
  | 'no_data'
  | 'unknown';

const PREFERRED_MIME = 'audio/webm;codecs=opus';
const FALLBACK_MIME = 'audio/webm';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (MediaRecorder.isTypeSupported(PREFERRED_MIME)) return PREFERRED_MIME;
  if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME;
  return undefined;
}

export type UseMicRecorder = {
  state: MicRecorderState;
  error: MicRecorderError | null;
  start: () => Promise<void>;
  stop: () => Promise<File | null>;
};

export function useMicRecorder(): UseMicRecorder {
  const [state, setState] = useState<MicRecorderState>('idle');
  const [error, setError] = useState<MicRecorderError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopResolverRef = useRef<((file: File | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<void> => {
    if (state !== 'idle') return;
    setError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError('unsupported');
      return;
    }

    setState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('permission_denied');
      setState('idle');
      return;
    }

    const mimeType = pickMimeType();
    if (!mimeType) {
      for (const t of stream.getTracks()) t.stop();
      setError('unsupported');
      setState('idle');
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const resolver = stopResolverRef.current;
      stopResolverRef.current = null;
      const chunks = chunksRef.current;
      cleanup();
      setState('idle');
      if (!resolver) return;
      if (chunks.length === 0) {
        setError('no_data');
        resolver(null);
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      const file = new File([blob], `recording-${Date.now()}.webm`, {
        type: mimeType,
      });
      resolver(file);
    });
    recorder.addEventListener('error', () => {
      setError('unknown');
    });

    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.start();
    setState('recording');
  }, [cleanup, state]);

  const stop = useCallback(async (): Promise<File | null> => {
    const recorder = recorderRef.current;
    if (!recorder || state !== 'recording') return null;
    setState('stopping');
    return new Promise<File | null>((resolve) => {
      stopResolverRef.current = resolve;
      recorder.stop();
    });
  }, [state]);

  return { state, error, start, stop };
}
