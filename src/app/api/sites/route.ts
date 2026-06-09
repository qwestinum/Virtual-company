/**
 * /api/sites — list + create (pré-requis reporting).
 * Admin légère des sites de l'organisation cliente (cf. /settings).
 */
import { NextResponse } from 'next/server';

import { insertSite, listSites } from '@/lib/db/repos/sites';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { SiteCreateSchema } from '@/types/organisation';

export const runtime = 'nodejs';

function notConfigured(): NextResponse {
  return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
}

function generateId(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `SITE-${rand}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const includeArchived =
    new URL(request.url).searchParams.get('includeArchived') === '1';
  try {
    const sites = await listSites({ includeArchived });
    return NextResponse.json({ sites });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: ReturnType<typeof SiteCreateSchema.parse>;
  try {
    parsed = SiteCreateSchema.parse(await request.json());
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
    const site = await insertSite(generateId(), parsed);
    return NextResponse.json({ site });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
