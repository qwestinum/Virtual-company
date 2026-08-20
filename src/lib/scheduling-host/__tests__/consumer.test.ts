/**
 * Consommateur d'événements de réservation — le remplaçant du webhook.
 *
 * Ce qui est vérifié ici tient en une phrase : LEVER veut dire « pas traité,
 * redonne-le moi », revenir normalement veut dire « traité, ne me le redonne
 * plus ». Tout le reste (rejeu, livraison en cours, échec transitoire) découle
 * de cette convention — et un contresens dessus produit soit un briefing perdu,
 * soit un briefing envoyé deux fois.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SchedEvent } from '@/lib/scheduling';

const {
  claimMock,
  confirmMock,
  releaseMock,
  deliverMock,
  awaitingMock,
  factsMock,
  briefMock,
  journalMock,
  sendEmailMock,
  getBookingMock,
  seriesMock,
  recipientsMock,
} = vi.hoisted(() => ({
  claimMock: vi.fn(),
  confirmMock: vi.fn(),
  releaseMock: vi.fn(),
  deliverMock: vi.fn(),
  awaitingMock: vi.fn(),
  factsMock: vi.fn(),
  briefMock: vi.fn(),
  journalMock: vi.fn(),
  sendEmailMock: vi.fn(),
  getBookingMock: vi.fn(),
  seriesMock: vi.fn(),
  recipientsMock: vi.fn(),
}));

vi.mock('@/lib/db/repos/booking-events', () => ({
  claimBookingEventDelivery: claimMock,
  confirmBookingEventDelivery: confirmMock,
  releaseBookingEventDelivery: releaseMock,
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  getBriefByBookingUid: briefMock,
  markBriefAwaitingBooking: awaitingMock,
  updateBriefBookingFacts: factsMock,
}));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: journalMock }));
vi.mock('@/lib/interview/deliver-brief', () => ({
  deliverBriefForBooking: deliverMock,
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/lib/campaign/synthesis-recipients', () => ({
  getSynthesisRecipientsForCampaign: recipientsMock,
}));
vi.mock('@/lib/scheduling', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduling')>(
    '@/lib/scheduling',
  );
  return { ...actual, getBooking: getBookingMock, resolveSeries: seriesMock };
});

import { handleSchedulingEvent } from '@/lib/scheduling-host/consumer';

const CONTEXT = {
  uid: '102',
  analysisId: 'can_imap_box-a_102',
  campaignId: 'CAMP-0001',
};

function event(overrides: Partial<SchedEvent> = {}): SchedEvent {
  return {
    id: 'evt-1',
    occurredAt: '2026-09-01T10:00:00.000Z',
    type: 'booking.created',
    booking: {
      id: 'bk-1',
      targetExternalRef: 'CAMP-0001',
      resourceExternalRef: 'user-1',
      startAt: '2026-09-10T08:00:00.000Z',
      endAt: '2026-09-10T08:45:00.000Z',
      attendee: {
        name: 'Alice Martin',
        email: 'alice@mail.com',
        phone: null,
        timezone: 'Europe/Paris',
      },
      meetingLocation: { type: 'phone', payload: { instructions: 'On vous appelle.' } },
      context: CONTEXT,
    },
    ...overrides,
  } as SchedEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimMock.mockResolvedValue('won');
  deliverMock.mockResolvedValue({ ok: true, status: 'delivered', retryable: false });
  awaitingMock.mockResolvedValue(1);
  factsMock.mockResolvedValue(1);
  briefMock.mockResolvedValue(null);
  journalMock.mockResolvedValue(undefined);
  recipientsMock.mockResolvedValue([]);
});

describe('booking.created', () => {
  it('retrouve la candidature par le CONTEXTE, jamais par l’email', async () => {
    await handleSchedulingEvent(event());

    expect(deliverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingUid: 'bk-1',
        identity: CONTEXT,
        location: 'On vous appelle.',
      }),
    );
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
  });

  it('un rejeu PROUVÉ ne délivre rien du tout', async () => {
    claimMock.mockResolvedValue('already_handled');
    await handleSchedulingEvent(event());
    expect(deliverMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('livraison PEUT-ÊTRE en cours ⇒ on DIFFÈRE (l’événement reste en file)', async () => {
    claimMock.mockResolvedValue('in_flight');
    await expect(handleSchedulingEvent(event())).rejects.toThrow(/claim_in_flight/);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('échec TRANSITOIRE ⇒ claim relâché + levée : le drain re-tentera', async () => {
    deliverMock.mockResolvedValue({
      ok: false,
      status: 'send_failed',
      retryable: true,
      error: 'resend down',
    });
    await expect(handleSchedulingEvent(event())).rejects.toThrow(/resend down/);
    expect(releaseMock).toHaveBeenCalledWith('evt-1');
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('issue TERMINALE (candidature introuvable) ⇒ acquittée, pas rejouée sans fin', async () => {
    deliverMock.mockResolvedValue({ ok: true, status: 'unmatched', retryable: false });
    await handleSchedulingEvent(event());
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('contexte illisible : on TRACE, et on n’écrit à personne', async () => {
    // Un lien émis par l'hôte porte TOUJOURS un contexte. Sans contexte, la
    // réservation vient d'ailleurs (harnais de démonstration, ligne d'outbox
    // oubliée) : retomber sur le rapprochement par email enverrait un « à
    // rattacher » à de vraies adresses à propos d'un rendez-vous fantôme —
    // c'est arrivé au premier drain de l'environnement de dev, 17/08/2026.
    const orphan = event();
    orphan.booking.context = { rien: 'du tout' };
    await handleSchedulingEvent(orphan);

    expect(deliverMock).not.toHaveBeenCalled();
    const entry = journalMock.mock.calls[0]![0] as {
      action: string;
      payload: Record<string, unknown>;
    };
    expect(entry.action).toBe('interview_booking_unmatched');
    expect(entry.payload.reason).toBe('no_host_context');
    // Acquitté : le rejouer ne changerait rien.
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
  });

  it('déplacement d’un rendez-vous qui n’est pas le nôtre : aucun mail non plus', async () => {
    briefMock.mockResolvedValue(null);
    const orphan = event({
      type: 'booking.rescheduled',
      booking: { ...event().booking, id: 'bk-9', rescheduledFrom: 'bk-8' },
    });
    orphan.booking.context = null;
    await handleSchedulingEvent(orphan);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(factsMock).not.toHaveBeenCalled();
  });
});

describe('booking.cancelled', () => {
  it('le briefing repart « en attente », et l’annulation CANDIDAT appelle une action', async () => {
    await handleSchedulingEvent(
      event({
        type: 'booking.cancelled',
        booking: { ...event().booking, cancelledBy: 'attendee', cancelReason: null },
      }),
    );

    expect(awaitingMock).toHaveBeenCalledWith('bk-1');
    expect(deliverMock).not.toHaveBeenCalled();
    const entry = journalMock.mock.calls[0]![0] as {
      action: string;
      payload: Record<string, unknown>;
    };
    expect(entry.action).toBe('interview_booking_cancelled');
    expect(entry.payload.needsAction).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
  });

  it('prévient l’équipe avec un .ics d’ANNULATION (le créneau doit quitter l’agenda)', async () => {
    recipientsMock.mockResolvedValue(['drh@cabinet.fr']);
    briefMock.mockResolvedValue({
      campaignId: 'CAMP-0001',
      candidateName: 'Alice Martin',
      jobTitle: 'Comptable',
      deliveredMessageId: null,
    });
    getBookingMock.mockResolvedValue({ id: 'bk-1', rescheduledFrom: null });
    seriesMock.mockResolvedValue({ rootId: 'bk-1', sequence: 0 });
    sendEmailMock.mockResolvedValue({ ok: true, messageId: 'm-1' });

    await handleSchedulingEvent(
      event({
        type: 'booking.cancelled',
        booking: { ...event().booking, cancelledBy: 'attendee' },
      }),
    );

    const sent = sendEmailMock.mock.calls[0]![0] as {
      subject: string;
      attachments?: { content: string; filename: string }[];
    };
    expect(sent.subject).toMatch(/annulé/i);
    const ics = Buffer.from(sent.attachments![0]!.content, 'base64').toString('utf8');
    // Sans CANCEL + SEQUENCE incrémenté, le rendez-vous resterait affiché.
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('UID:bk-1@orqa.qwestinum');
    expect(ics).toContain('SEQUENCE:1');
  });

  it('le briefing est lu AVANT que la transition n’efface sa clé', async () => {
    // Inversé, l'ordre ferait perdre le nom du candidat ET la campagne : le
    // message partirait à la liste globale au lieu des bons destinataires.
    const order: string[] = [];
    briefMock.mockImplementation(async () => {
      order.push('lecture');
      return null;
    });
    awaitingMock.mockImplementation(async () => {
      order.push('transition');
      return 1;
    });
    await handleSchedulingEvent(
      event({
        type: 'booking.cancelled',
        booking: { ...event().booking, cancelledBy: 'attendee' },
      }),
    );
    expect(order).toEqual(['lecture', 'transition']);
  });

  it('annulation par l’ORGANISATION : même transition, aucune relance attendue', async () => {
    await handleSchedulingEvent(
      event({
        type: 'booking.cancelled',
        booking: { ...event().booking, cancelledBy: 'organizer' },
      }),
    );
    const entry = journalMock.mock.calls[0]![0] as { payload: Record<string, unknown> };
    expect(entry.payload.needsAction).toBe(false);
  });
});

describe('booking.rescheduled', () => {
  it('met à jour les faits du briefing et suit le NOUVEL identifiant', async () => {
    briefMock.mockResolvedValue({
      campaignId: 'CAMP-0001',
      candidateName: 'Alice Martin',
      jobTitle: 'Comptable',
      deliveredMessageId: 'msg-1',
    });
    getBookingMock.mockResolvedValue(null);

    await handleSchedulingEvent(
      event({
        type: 'booking.rescheduled',
        booking: {
          ...event().booking,
          id: 'bk-2',
          rescheduledFrom: 'bk-1',
          previousStartAt: '2026-09-09T08:00:00.000Z',
        },
      }),
    );

    expect(factsMock).toHaveBeenCalledWith(
      'bk-1',
      expect.objectContaining({ bookingUid: 'bk-2' }),
    );
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
  });

  it('sans adresse de synthèse : rien n’est envoyé, l’événement reste acquitté', async () => {
    recipientsMock.mockResolvedValue([]);
    await handleSchedulingEvent(
      event({
        type: 'booking.rescheduled',
        booking: { ...event().booking, id: 'bk-2', rescheduledFrom: 'bk-1' },
      }),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledWith('evt-1');
  });

  it('invitation d’agenda à jour : UID de la SÉRIE, rang incrémenté', async () => {
    recipientsMock.mockResolvedValue(['drh@cabinet.fr']);
    getBookingMock.mockResolvedValue({ id: 'bk-2', rescheduledFrom: 'bk-1' });
    seriesMock.mockResolvedValue({ rootId: 'bk-1', sequence: 1 });
    sendEmailMock.mockResolvedValue({ ok: true, messageId: 'm-1' });

    await handleSchedulingEvent(
      event({
        type: 'booking.rescheduled',
        booking: { ...event().booking, id: 'bk-2', rescheduledFrom: 'bk-1' },
      }),
    );

    const sent = sendEmailMock.mock.calls[0]![0] as {
      attachments?: { content: string }[];
    };
    const ics = Buffer.from(sent.attachments![0]!.content, 'base64').toString('utf8');
    // La RACINE de la chaîne, pas le nouvel identifiant : c'est ce qui fait
    // qu'un agenda DÉPLACE le rendez-vous au lieu d'en afficher un second.
    expect(ics).toContain('UID:bk-1@orqa.qwestinum');
    expect(ics).not.toContain('UID:bk-2');
    expect(ics).toContain('SEQUENCE:1');
  });
});
