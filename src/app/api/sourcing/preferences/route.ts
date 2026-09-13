/**
 * GET / PATCH /api/sourcing/preferences — préférences du recruteur connecté :
 * format de message LinkedIn, tri « en recherche d'abord ». Les siennes, jamais
 * celles d'un autre.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSourcingPreferences, patchSourcingPreferences } from '@/lib/db/repos/sourcing-approaches';
import { guardSourcing } from '@/lib/sourcing/server/route-guard';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({ messageFormat: z.enum(['connection_note', 'inmail']), availableFirst: z.boolean() })
  .partial();

export async function GET(): Promise<NextResponse> {
  const guard = await guardSourcing();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ preferences: await getSourcingPreferences(guard.value.id) });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await guardSourcing();
  if (!guard.ok) return guard.response;
  const body = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'invalid_request', message: body.error.message }, { status: 400 });
  const saved = await patchSourcingPreferences(guard.value.id, body.data).catch(() => false);
  return NextResponse.json({ saved, preferences: await getSourcingPreferences(guard.value.id) });
}
