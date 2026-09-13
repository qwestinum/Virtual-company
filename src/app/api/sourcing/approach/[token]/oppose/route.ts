/**
 * POST /api/sourcing/approach/[token]/oppose — « je ne souhaite pas être
 * recontacté·e ». PUBLIQUE, jeton de l'URL. Spec : docs/specs/sourcing.md §12.1.
 *
 * Opposition GLOBALE : l'empreinte est exclue de toute recherche future, ses
 * profils sont supprimés sur toutes les campagnes, les liens encore ouverts
 * sont révoqués et vidés. Seule l'empreinte (salée, non réversible) reste.
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { recordOpposition } from '@/lib/db/repos/sourcing-admission';
import { clientIp, consumeQuota } from '@/lib/jobboard/rate-limit';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const quota = await consumeQuota({ key: `sourcing:oppose:${clientIp(request) ?? 'unknown'}`, limit: 5, windowSeconds: 600 });
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Trop de tentatives. Merci de réessayer dans quelques minutes.' },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
    );
  }

  const { token } = await params;
  const { state, approach } = await resolveLandingContext(token);
  // Un lien inconnu ou retiré ne porte aucune empreinte à exclure.
  if (!approach || state.kind === 'unavailable') return NextResponse.json({ outcome: 'unavailable' });

  try {
    const result = await recordOpposition(approach.fingerprint);
    await appendJournalEntry({
      action: 'sourcing_opposition_recorded',
      actor: 'sourcing',
      campaignId: approach.campaignId,
      payload: { fingerprint: approach.fingerprint, profilesDeleted: result.profilesDeleted, approachesRevoked: result.approachesRevoked },
    }).catch(() => {});
    return NextResponse.json({ outcome: 'opposed' });
  } catch {
    return NextResponse.json(
      { error: 'opposition_failed', message: 'Votre demande n’a pas pu être enregistrée. Merci de réessayer.' },
      { status: 503 },
    );
  }
}
