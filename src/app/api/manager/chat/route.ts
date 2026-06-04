import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ManagerError,
  runManagerTurn,
  type ConversationTurn,
} from '@/lib/agents/manager';
import type { ReportingSnapshot } from '@/lib/agents/manager-reporting';
import { AIProviderError } from '@/lib/ai/errors';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { listJournalEntries } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { FDPInProgressSchema } from '@/types/field-collection';

/**
 * Charge les données de reporting depuis Supabase. Appelé paresseusement
 * par runManagerTurn seulement pour les intentions suivi/reporting. Si la
 * persistance n'est pas configurée → null (réponse dégradée côté Manager).
 */
async function loadReportingSnapshot(): Promise<ReportingSnapshot | null> {
  try {
    const [campaigns, journal] = await Promise.all([
      listCampaigns(),
      listJournalEntries({ limit: 500 }),
    ]);
    return { campaigns, journal };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    console.error('[manager/chat] loadReportingSnapshot failed', err);
    return null;
  }
}

export const runtime = 'nodejs';
// runManagerTurn enchaîne 2 appels OpenAI (classification + conversation),
// chacun avec un timeout client de 30s — budget pire cas = 60s. Sans effet
// en `next dev` ; appliqué en serverless / Vercel et certains adapters.
export const maxDuration = 60;

const TurnSchema = z.object({
  role: z.enum(['user', 'manager']),
  content: z.string().min(1),
});

const RequestSchema = z.object({
  messages: z.array(TurnSchema).min(1).max(40),
  fdp: FDPInProgressSchema.nullable().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsedBody: z.infer<typeof RequestSchema>;
  try {
    const json = await request.json();
    parsedBody = RequestSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await runManagerTurn({
      history: parsedBody.messages as ConversationTurn[],
      fdp: parsedBody.fdp ?? null,
      loadReportingSnapshot,
    });

    return NextResponse.json({
      classification: result.classification,
      response: result.response,
      campaignId: result.campaignId,
      preSearchHits: result.preSearchHits,
      pendingSwitch: result.pendingSwitch,
      metrics: result.metrics,
    });
  } catch (err) {
    if (err instanceof ManagerError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 502 },
      );
    }
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
