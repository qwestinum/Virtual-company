/**
 * POST /api/sourcing/profiles/[id]/decline — le recruteur écarte un profil.
 *
 * Verdict EFFACER immédiat : l'exclusion (empreinte seule) est posée, puis la
 * ligne et ses données disparaissent. Le profil ne reviendra pas dans une
 * recherche de cette campagne. Journal sans donnée personnelle.
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { declineSourcingProfile } from '@/lib/db/repos/sourcing-approaches';
import { guardSourcingProfile } from '@/lib/sourcing/server/route-guard';

export const runtime = 'nodejs';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingProfile(id);
  if (!guard.ok) return guard.response;
  const { profile, user } = guard.value;
  if (profile.state === 'contacted') {
    return NextResponse.json({ error: 'already_contacted', message: 'Ce profil a déjà été approché.' }, { status: 409 });
  }
  try {
    await declineSourcingProfile(profile);
    await appendJournalEntry({
      action: 'sourcing_profile_declined',
      campaignId: profile.campaignId,
      actor: user.email ?? 'utilisateur',
      payload: { fingerprint: profile.fingerprint, actorUserId: user.id },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'decline_failed', message: (err as Error).message }, { status: 500 });
  }
}
