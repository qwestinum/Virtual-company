/**
 * POST /api/mailboxes/[id]/associate — associe une mailbox à une
 * campagne (relation many-to-many).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  associateCampaignMailbox,
  dissociateCampaignMailbox,
} from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const PostSchema = z.object({ campaignId: z.string().min(1) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PostSchema>;
  try {
    parsed = PostSchema.parse(await request.json());
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
    await associateCampaignMailbox(parsed.campaignId, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign_id');
  if (!campaignId) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'campaign_id query param required.' },
      { status: 400 },
    );
  }
  try {
    await dissociateCampaignMailbox(campaignId, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
