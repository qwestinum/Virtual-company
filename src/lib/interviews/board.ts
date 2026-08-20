/**
 * Vue « Entretiens » — ce que l'équipe doit voir des rendez-vous.
 *
 * Trois listes, et la troisième est celle qui compte : les rendez-vous pris,
 * ceux qu'on attend encore, et les SIGNAUX (cible sans référent, lien mort,
 * annulation candidat). Un module de réservation qui n'affiche que ce qui a
 * bien marché laisse découvrir les ratés par le candidat.
 *
 * L'assemblage vit ici, hors de la route : c'est testable, et la route se
 * limite à autoriser, filtrer et répondre.
 */
import { getCampaign, listCampaigns } from '@/lib/db/repos/campaigns';
import { getBriefByBookingUid } from '@/lib/db/repos/interview-briefs';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import {
  describeMeetingLocation,
  listBookings,
  listLinksForTarget,
  listOrphanTargets,
  type Booking,
} from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import { parseBookingContext } from '@/lib/scheduling-host/campaign-booking';

import { groupByCandidature, type CandidatureState } from './board-rows';

export type InterviewRow = {
  bookingId: string;
  campaignId: string | null;
  campaignName: string | null;
  candidateName: string;
  candidateEmail: string;
  recruiterName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  location: string | null;
  status: 'confirmed' | 'cancelled';
  cancelledBy: 'attendee' | 'organizer' | null;
  /** Identité de la candidature — sert au bouton « renvoyer un lien ». */
  analysisId: string | null;
  /**
   * État COURANT de la candidature, pas de cette réservation : un créneau
   * décommandé pour cause de replanification n'est pas « annulé » si un
   * nouveau lien attend déjà.
   */
  state: CandidatureState;
  /** Créneaux tombés avant celui-ci (replanifications, annulations). */
  droppedSlots: number;
};

export type OrphanRow = {
  campaignId: string;
  campaignName: string | null;
  activeLinks: number;
};

export type DeadLinkRow = {
  campaignId: string;
  campaignName: string | null;
  analysisId: string;
  candidateName: string | null;
  status: 'expired' | 'revoked';
};

export type InterviewBoard = {
  bookings: InterviewRow[];
  orphans: OrphanRow[];
  deadLinks: DeadLinkRow[];
  /** Liens encore ouverts : des candidats invités qui n'ont pas encore choisi. */
  awaitingBooking: number;
};

export type BoardFilter = {
  campaignId?: string | null;
  recruiterId?: string | null;
  from?: string | null;
  to?: string | null;
};

export async function loadInterviewBoard(
  filter: BoardFilter = {},
): Promise<InterviewBoard> {
  await ensureSchedulingConfigured();

  const [campaigns, recruiters] = await Promise.all([
    listCampaigns().catch(() => []),
    listRecruiters().catch(() => []),
  ]);
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const recruiterNames = new Map(recruiters.map((r) => [r.id, r.displayName]));

  const bookings = await listBookings({
    ...(filter.campaignId ? { targetExternalRef: filter.campaignId } : {}),
    ...(filter.recruiterId ? { resourceExternalRef: filter.recruiterId } : {}),
    ...(filter.from ? { from: filter.from } : {}),
    ...(filter.to ? { to: filter.to } : {}),
  });

  // Cibles orphelines : des liens actifs pointent une campagne sans référent
  // actif. Les candidats concernés voient en ce moment une page dégradée.
  const orphans = (await listOrphanTargets().catch(() => []))
    .filter((o) => !filter.campaignId || o.target.externalRef === filter.campaignId)
    .map((o) => ({
      campaignId: o.target.externalRef,
      campaignName: campaignNames.get(o.target.externalRef) ?? null,
      activeLinks: o.activeLinks,
    }));

  // Liens morts et liens en attente, campagne par campagne. Limité aux
  // campagnes en réservation native : les autres n'ont pas de cible.
  const nativeCampaigns = campaigns.filter(
    (c) => c.schedulingNative && (!filter.campaignId || c.id === filter.campaignId),
  );
  const deadLinks: DeadLinkRow[] = [];
  /** Candidatures dont un lien de réservation est ENCORE ouvert. */
  const activeLinkKeys = new Set<string>();
  let awaitingBooking = 0;
  for (const campaign of nativeCampaigns) {
    const links = await listLinksForTarget(campaign.id).catch(() => []);
    for (const link of links) {
      if (link.status === 'active') {
        awaitingBooking += 1;
        const context = parseBookingContext(link.context);
        activeLinkKeys.add(context?.analysisId ?? link.idempotencyKey);
        continue;
      }
      if (link.status === 'expired' || link.status === 'revoked') {
        const context = parseBookingContext(link.context);
        deadLinks.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          analysisId: context?.analysisId ?? link.idempotencyKey,
          candidateName: link.display.attendeeName ?? null,
          status: link.status,
        });
      }
    }
  }

  // UNE ligne par candidature, pas une par réservation : sans ce
  // rapprochement, chaque replanification laisse une annulation de plus dans
  // la liste et l'écran donne à lire une suite d'échecs.
  const grouped = groupByCandidature(
    bookings.map((booking) => ({
      bookingId: booking.id,
      analysisId: parseBookingContext(booking.context)?.analysisId ?? null,
      status: booking.status,
      cancelledBy: booking.cancelledBy,
      startAt: booking.startAt,
      booking,
    })),
    activeLinkKeys,
  );

  const rows = await Promise.all(
    grouped.map((g) =>
      toRow(g.current.booking, campaignNames, recruiterNames, {
        state: g.state,
        droppedSlots: g.droppedSlots,
      }),
    ),
  );

  return { bookings: rows, orphans, deadLinks, awaitingBooking };
}

async function toRow(
  booking: Booking,
  campaignNames: Map<string, string>,
  recruiterNames: Map<string, string>,
  grouping: { state: CandidatureState; droppedSlots: number },
): Promise<InterviewRow> {
  const context = parseBookingContext(booking.context);
  // Le nom du briefing prime : c'est celui de la candidature, pas celui que
  // l'invité a tapé dans le formulaire.
  const brief = await getBriefByBookingUid(booking.id).catch(() => null);
  return {
    bookingId: booking.id,
    campaignId: context?.campaignId ?? null,
    campaignName: context ? (campaignNames.get(context.campaignId) ?? null) : null,
    candidateName: brief?.candidateName ?? booking.attendee.name,
    candidateEmail: booking.attendee.email,
    recruiterName:
      recruiterNames.get(booking.resourceExternalRef) ?? 'Recruteur inconnu',
    startAt: booking.startAt,
    endAt: booking.endAt,
    timezone: booking.attendee.timezone,
    location: describeMeetingLocation(booking.meetingLocation),
    status: booking.status,
    cancelledBy: booking.cancelledBy,
    analysisId: context?.analysisId ?? null,
    state: grouping.state,
    droppedSlots: grouping.droppedSlots,
  };
}

/** Campagne d'un rendez-vous — utilisée par les actions de la vue. */
export async function campaignForBooking(
  booking: Booking,
): Promise<{ id: string; name: string } | null> {
  const context = parseBookingContext(booking.context);
  if (!context) return null;
  const campaign = await getCampaign(context.campaignId).catch(() => null);
  return campaign ? { id: campaign.id, name: campaign.name } : null;
}
