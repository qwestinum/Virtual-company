import { NextResponse } from 'next/server';

import { AIProviderError } from '@/lib/ai/errors';
import { transcribe } from '@/lib/ai/provider';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'];

export async function POST(request: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid form data.',
      },
      { status: 400 },
    );
  }

  const audio = formData.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Field `audio` (File) is required.' },
      { status: 400 },
    );
  }

  if (audio.size === 0) {
    return NextResponse.json(
      { error: 'empty_audio', message: 'Audio file is empty.' },
      { status: 400 },
    );
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'audio_too_large', message: 'Audio exceeds 10MB limit.' },
      { status: 413 },
    );
  }
  if (audio.type && !ACCEPTED_MIME.some((m) => audio.type.startsWith(m))) {
    return NextResponse.json(
      {
        error: 'unsupported_mime',
        message: `Unsupported audio mime type: ${audio.type}`,
      },
      { status: 415 },
    );
  }

  const language = formData.get('language');
  const lang = typeof language === 'string' && language.length > 0 ? language : 'fr';

  try {
    const result = await transcribe({ audio, language: lang });
    return NextResponse.json({
      text: result.text,
      durationMs: result.durationMs,
      model: result.model,
    });
  } catch (err) {
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: 'unexpected_error',
        message: err instanceof Error ? err.message : 'Unexpected error.',
      },
      { status: 500 },
    );
  }
}
