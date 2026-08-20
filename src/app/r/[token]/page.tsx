/**
 * Page publique de réservation — coquille Next autour du composant du module.
 *
 * L'état est résolu ICI, côté serveur : la page arrive donc déjà dans le bon
 * état (ouvert, dégradé, éteint) sans clignotement, et surtout sans qu'un
 * jeton mort déclenche un appel d'API depuis le navigateur.
 */
import type { Metadata } from 'next';

import {
  branding,
  getConfirmedBookingByLink,
  labels,
  organizationName,
  resolveBookingPage,
} from '@/lib/scheduling';
import {
  BookingPage,
  BrandMark,
  SCHEDULING_CSS,
  brandRootStyle,
  type BookingConfirmation,
} from '@/lib/scheduling/ui';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Une page tokenisée n'a rien à faire dans un index. */
export const metadata: Metadata = {
  title: 'Prendre rendez-vous',
  robots: { index: false, follow: false, nocache: true },
};

export default async function BookingRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await ensureSchedulingConfigured();
  const { token } = await params;

  const state = await resolveBookingPage(token).catch(() => null);
  const uiLabels = labels();

  if (!state) {
    return (
      <Frame>
        <BookingPage
          token={token}
          state={{ status: 'gone', display: null, reason: 'unknown' }}
          labels={uiLabels}
          apiBase="/api/sched"
        />
      </Frame>
    );
  }

  // Lien déjà consommé : on retrouve le rendez-vous qu'il a produit, pour le
  // rappeler plutôt que d'afficher un mur. C'est le seul cas où l'on en dit
  // plus qu'un laconique « lien inactif ».
  let existing: BookingConfirmation | null = null;
  if (state.status === 'gone' && state.reason === 'used') {
    existing = await findBookingForLink(token).catch(() => null);
  }

  return (
    <Frame>
      <BookingPage
        token={token}
        state={state}
        labels={uiLabels}
        apiBase="/api/sched"
        existing={existing}
      />
    </Frame>
  );
}

async function findBookingForLink(token: string): Promise<BookingConfirmation | null> {
  const booking = await getConfirmedBookingByLink(token);
  if (!booking) return null;
  return {
    startAt: booking.startAt,
    endAt: booking.endAt,
    timeZone: booking.attendee.timezone,
    meetingLocation: booking.meetingLocation,
    manageUrl: `/b/${booking.manageToken}`,
  };
}

/**
 * Coquille visuelle : la marque de l'installation et sa couleur d'accent. Le
 * logo vit ICI, au-dessus de la carte, pour rester affiché quel que soit
 * l'état de la page (ouverte, dégradée, éteinte).
 */
function Frame({ children }: { children: React.ReactNode }) {
  const brand = branding();
  return (
    <div className="sched-root" style={brandRootStyle(brand)}>
      <style dangerouslySetInnerHTML={{ __html: SCHEDULING_CSS }} />
      <BrandMark brand={brand} alt={organizationName()} />
      {children}
    </div>
  );
}
