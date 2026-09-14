/**
 * GET /api/campaigns/[id]/scheduling — l'état « réservation » d'une campagne.
 *
 * Deux choses, qui servent le même écran : l'IMPACT d'un changement de
 * référent, et le lieu de rencontre propre à la campagne.
 *
 * L'impact se montre AVANT d'écrire, même esprit que le dialog de clôture
 * sans-suite. Deux chiffres suffisent, et ils ne disent pas la même chose —
 * les liens encore actifs BASCULENT sur le nouvel agenda sans réémission ; les
 * rendez-vous déjà pris NE BOUGENT PAS (un rendez-vous est un engagement).
 *
 * Répond un impact NUL plutôt qu'une erreur quand la campagne n'a pas encore
 * de cible : c'est le cas d'une campagne qui n'a jamais invité personne.
 */
import { NextResponse } from 'next/server';

import { getCampaign } from '@/lib/db/repos/campaigns';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getTargetImpact } from '@/lib/scheduling';
import {
  createCampaignBookingContext,
  resolveCampaignMeetingLocation,
} from '@/lib/scheduling-host/campaign-booking';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!campaign.schedulingNative) {
      // Régime Cal.com : changer de référent ne déplace aucun lien émis (ils
      // pointent l'agenda personnel, figé dans le mail déjà parti).
      return NextResponse.json({
        native: false,
        activeLinks: 0,
        bookings: [],
        meetingLocationOverride: null,
        inheritedMeetingLocation: null,
      });
    }

    await ensureSchedulingConfigured();
    // Contexte résolu UNE fois : la campagne (déjà lue ci-dessus) et la cible
    // servent à la fois l'impact et le lieu, au lieu d'être relues par chacun.
    const bookingContext = createCampaignBookingContext(id, { campaign });
    // Les noms des recruteurs ne dépendent de rien : lus dès maintenant, même
    // repli qu'avant (liste vide).
    const recruitersPromise = listRecruiters().catch(() => []);
    // Le lieu HÉRITÉ voyage avec la surcharge : un écran qui propose
    // « hériter du référent » doit montrer ce dont il hérite. Annoncer un
    // héritage sans dire lequel laisse croire au recruteur qu'il a posé le
    // lieu qu'il avait en tête — c'est exactement le malentendu à couper.
    const [impact, place] = await Promise.all([
      bookingContext.target().then((target) => (target ? getTargetImpact(target) : null)),
      resolveCampaignMeetingLocation(id, bookingContext),
    ]);
    const meetingLocationOverride = place.override;
    const inheritedMeetingLocation = place.inherited;
    if (!impact) {
      return NextResponse.json({
        native: true,
        activeLinks: 0,
        bookings: [],
        meetingLocationOverride,
        inheritedMeetingLocation,
      });
    }

    // Les identifiants de ressource sont des identifiants de compte : on rend
    // des NOMS, sinon le dialog affiche un UUID à un humain.
    const names = new Map((await recruitersPromise).map((r) => [r.id, r.displayName]));
    return NextResponse.json({
      native: true,
      meetingLocationOverride,
      inheritedMeetingLocation,
      activeLinks: impact.activeLinks,
      bookings: impact.confirmedUpcomingBookings.map((b) => ({
        recruiterName: names.get(b.resourceExternalRef) ?? 'un recruteur',
        count: b.count,
      })),
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'scheduling_state_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
