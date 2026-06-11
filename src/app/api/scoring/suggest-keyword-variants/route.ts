/**
 * POST /api/scoring/suggest-keyword-variants — propose des variantes de
 * mots-clés pour un critère au cadrage (Phase 3b, cf. scoring-hybrid.md §3b).
 * Pas de cache (appel manuel, peu fréquent).
 */
import { NextResponse } from 'next/server';

import {
  KeywordVariantsRequestSchema,
  runKeywordVariantsSuggestion,
} from '@/lib/agents/server/keyword-variants-execute';
import { AIProviderError, AIValidationError } from '@/lib/ai/errors';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Corps JSON invalide.' },
      { status: 400 },
    );
  }

  const parsed = KeywordVariantsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    const result = await runKeywordVariantsSuggestion(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 503 : 502;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    if (err instanceof AIValidationError) {
      return NextResponse.json(
        { error: 'invalid_llm_response', message: err.message },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'suggest_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
