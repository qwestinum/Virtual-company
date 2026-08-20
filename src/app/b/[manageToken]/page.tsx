/**
 * Page de gestion d'un rendez-vous — coquille Next autour du composant du
 * module. Le rendez-vous est chargé côté serveur : un jeton mort n'entraîne
 * aucun appel depuis le navigateur.
 */
import type { Metadata } from 'next';

import {
  branding,
  getBookingByManageToken,
  labels,
  organizationName,
} from '@/lib/scheduling';
import {
  BrandMark,
  ManagePage,
  SCHEDULING_CSS,
  brandRootStyle,
  type ManageBooking,
} from '@/lib/scheduling/ui';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Votre rendez-vous',
  robots: { index: false, follow: false, nocache: true },
};

export default async function ManageRoute({
  params,
}: {
  params: Promise<{ manageToken: string }>;
}) {
  await ensureSchedulingConfigured();
  const { manageToken } = await params;

  const booking = await getBookingByManageToken(manageToken).catch(() => null);

  const view: ManageBooking | null = booking
    ? {
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: booking.status,
        durationMinutes: Math.round(
          (Date.parse(booking.endAt) - Date.parse(booking.startAt)) / 60_000,
        ),
        meetingLocation: booking.meetingLocation,
        attendeeTimezone: booking.attendee.timezone,
        organisation: organizationName(),
      }
    : null;

  const brand = branding();
  return (
    <div className="sched-root" style={brandRootStyle(brand)}>
      <style dangerouslySetInnerHTML={{ __html: SCHEDULING_CSS }} />
      <BrandMark brand={brand} alt={organizationName()} />
      <ManagePage
        manageToken={manageToken}
        booking={view}
        labels={labels()}
        apiBase="/api/sched"
      />
    </div>
  );
}
