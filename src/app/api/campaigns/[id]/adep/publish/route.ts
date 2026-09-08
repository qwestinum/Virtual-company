/**
 * Publication d'une campagne sur apec.fr.
 *
 * ── LE CORPS DE LA REQUÊTE EST L'OFFRE RELUE ────────────────────────────────
 *
 * On envoie ce que l'humain a sous les yeux, pas ce que le serveur recalcule.
 * C'est le principe du preview HITL : le point de vérité est l'écran, parce que
 * c'est lui qui a été relu. Le serveur revalide (il ne fait jamais confiance au
 * client) mais il ne RÉÉCRIT pas.
 *
 * ── LA VALIDATION EST ICI, L'IDEMPOTENCE EST DANS LE SERVICE ────────────────
 *
 * Cette route refuse une offre invalide AVANT toute réservation : réserver une
 * référence pour un flux qu'on sait refusé consommerait un numéro de tentative
 * pour rien, et la publication suivante partirait sous `CAMP-XXXX-2` sans
 * raison.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { AdepCredentialsError, publishToAdep } from '@/lib/jobboards/adep/service';
import { validateAdepOffer } from '@/lib/jobboards/adep/validate';
import { AdepOfferSchema } from '@/types/adep';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Jour courant, fuseau France — les règles de date de l'Apec sont civiles. */
function today(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // La référence et l'identifiant de transaction sont posés par le SERVICE :
  // les accepter du client permettrait de rejouer une référence déjà utilisée,
  // c'est-à-dire de contourner le verrou d'idempotence.
  const parsed = AdepOfferSchema.omit({
    clientPositionId: true,
    trackingId: true,
  }).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_offer', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const report = validateAdepOffer(
      { ...parsed.data, clientPositionId: id, trackingId: 'validation' },
      today(),
    );
    if (!report.ok) {
      return NextResponse.json(
        { error: 'offer_invalid', errors: report.errors, warnings: report.warnings },
        { status: 422 },
      );
    }

    const result = await publishToAdep({
      campaignId: id,
      ownerUserId: campaign.ownerUserId,
      offer: parsed.data,
    });

    const { outcome } = result;
    await appendJournalEntry({
      action:
        outcome.kind === 'published' || outcome.kind === 'already_published'
          ? 'apec_offer_published'
          : 'apec_offer_publish_failed',
      actor: user.email ?? 'utilisateur',
      campaignId: id,
      payload: {
        outcome: outcome.kind,
        simulated: result.simulated,
        clientReference: result.posting?.clientReference ?? null,
        apecPositionNumero: result.posting?.apecPositionNumero ?? null,
        ...(outcome.kind === 'rejected'
          ? { issues: outcome.issues.map((i) => ({ code: i.code, message: i.message })) }
          : {}),
        ...(outcome.kind === 'uncertain' || outcome.kind === 'unavailable'
          ? { reason: outcome.reason }
          : {}),
      },
    }).catch(() => {});

    const status =
      outcome.kind === 'published' || outcome.kind === 'already_published'
        ? 200
        : outcome.kind === 'rejected'
          ? 422
          : 503;
    return NextResponse.json(
      { outcome, posting: result.posting, simulated: result.simulated, warnings: report.warnings },
      { status },
    );
  } catch (err) {
    if (err instanceof AdepCredentialsError) {
      // Un préalable manquant n'est pas une panne : c'est un réglage. On rend
      // le message tel quel, il dit quoi faire.
      return NextResponse.json({ error: err.code, message: err.message }, { status: 409 });
    }
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/campaigns/adep/publish] failed', err);
    return NextResponse.json({ error: 'publish_failed' }, { status: 500 });
  }
}
