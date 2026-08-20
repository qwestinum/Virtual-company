/**
 * Gabarits de messages — tests PURS.
 *
 * On ne vérifie pas la jolie tournure : on vérifie les deux règles qui, si
 * elles cassent, produisent un rendez-vous manqué ou une promesse non tenue.
 * Toute heure porte son fuseau, et aucun message n'invite à répondre à une
 * boîte que personne ne lit.
 */
import { describe, expect, it } from 'vitest';

import { FR_LABELS } from '../labels';
import {
  bookingCancelledForAttendee,
  bookingConfirmedForAttendee,
  bookingConfirmedForOrganizer,
  bookingRescheduledForAttendee,
} from '../mail-templates';
import type { Booking } from '../types';

const BOOKING: Booking = {
  id: 'b-1',
  linkToken: 'tok',
  targetId: 'tg',
  targetExternalRef: 'TARGET',
  resourceId: 'res',
  resourceExternalRef: 'RESOURCE',
  startAt: '2026-09-07T07:00:00.000Z',
  endAt: '2026-09-07T07:45:00.000Z',
  status: 'confirmed',
  cancelledBy: null,
  cancelledReason: null,
  cancelledAt: null,
  rescheduledFrom: null,
  attendee: {
    name: 'Alex Martin',
    email: 'alex@exemple.test',
    phone: '06 12 34 56 78',
    timezone: 'Europe/Paris',
  },
  context: { opaque: true },
  meetingLocation: { type: 'video', payload: { url: 'https://visio.test/salle' } },
  manageToken: 'm-1',
  createdAt: '2026-09-01T10:00:00.000Z',
};

const CONTEXT = {
  labels: FR_LABELS,
  organizationName: 'Cabinet Démo',
  manageUrl: 'https://demo.test/b/m-1',
};

describe('confirmation vers l’invité', () => {
  const mail = bookingConfirmedForAttendee(BOOKING, CONTEXT);

  it('annonce l’heure LOCALE de l’invité, avec son fuseau', () => {
    // 07:00 UTC = 09:00 à Paris en septembre. C'est l'heure de l'invité qui
    // s'affiche, jamais l'heure UTC ni celle du serveur.
    expect(mail.text).toContain('09:00');
    expect(mail.text).toContain('heure de Paris');
    expect(mail.subject).toContain('09:00');
  });

  it('donne le lieu et le moyen de revenir en arrière', () => {
    expect(mail.text).toContain('https://visio.test/salle');
    expect(mail.text).toContain('https://demo.test/b/m-1');
  });

  it('signe du nom de l’organisation quand l’hôte en fournit un', () => {
    expect(mail.text).toContain('Cabinet Démo');
    const anonymous = bookingConfirmedForAttendee(BOOKING, {
      ...CONTEXT,
      organizationName: null,
    });
    expect(anonymous.text).not.toContain('Cabinet Démo');
  });

  it('n’invite jamais à répondre au message', () => {
    expect(mail.text.toLowerCase()).not.toContain('répondez à ce message');
    expect(mail.text.toLowerCase()).not.toContain('répondre à cet email');
  });

  it('rend un HTML dont les liens sont cliquables', () => {
    expect(mail.html).toContain('<a href="https://visio.test/salle"');
  });
});

describe('notification vers la personne qui reçoit', () => {
  const mail = bookingConfirmedForOrganizer(BOOKING, CONTEXT, 'Europe/Paris');

  it('donne de quoi joindre l’invité', () => {
    expect(mail.text).toContain('alex@exemple.test');
    expect(mail.text).toContain('06 12 34 56 78');
  });

  it('ne transmet PAS le lien de gestion — ce jeton n’est pas le sien', () => {
    expect(mail.text).not.toContain('m-1');
  });

  it('ne laisse jamais fuir le contexte de l’hôte', () => {
    expect(mail.text).not.toContain('opaque');
  });
});

describe('déplacement', () => {
  const moved: Booking = {
    ...BOOKING,
    id: 'b-2',
    startAt: '2026-09-08T08:00:00.000Z',
    endAt: '2026-09-08T08:45:00.000Z',
    rescheduledFrom: 'b-1',
  };
  const mail = bookingRescheduledForAttendee(moved, BOOKING, CONTEXT);

  it('montre les deux créneaux, pour lever toute ambiguïté', () => {
    expect(mail.text).toContain('10:00'); // nouveau, heure de Paris
    expect(mail.text).toContain('09:00'); // ancien
    expect(mail.text).toContain('Ancien créneau');
  });

  it('annonce que l’agenda sera mis à jour, pas dupliqué', () => {
    expect(mail.text).toContain('remplacé');
  });
});

describe('annulation', () => {
  const mail = bookingCancelledForAttendee(
    { ...BOOKING, status: 'cancelled', cancelledBy: 'attendee' },
    CONTEXT,
  );

  it('rappelle le créneau annulé avec son fuseau', () => {
    expect(mail.subject).toContain('annulé');
    expect(mail.text).toContain('09:00');
    expect(mail.text).toContain('heure de Paris');
  });

  it('explique ce que fait la pièce jointe', () => {
    expect(mail.text).toContain('retire l’événement');
  });
});
