/**
 * Rapprochement des réservations d'une candidature — PUR.
 *
 * Le défaut d'origine : la vue listait des RÉSERVATIONS. Replanifier laisse
 * une réservation annulée en base ; replanifier deux fois en laisse deux. À
 * l'écran, cela donnait à lire une suite d'échecs, alors qu'il s'agit d'un
 * seul rendez-vous en cours de calage.
 */
import { describe, expect, it } from 'vitest';

import { groupByCandidature, type BookingFacts } from '@/lib/interviews/board-rows';

function booking(over: Partial<BookingFacts> & { bookingId: string }): BookingFacts {
  return {
    analysisId: 'can_1',
    status: 'confirmed',
    cancelledBy: null,
    startAt: '2026-09-10T08:00:00.000Z',
    ...over,
  };
}

describe('une ligne par candidature', () => {
  it('deux replanifications ⇒ UNE ligne, pas trois', () => {
    const rows = groupByCandidature(
      [
        booking({
          bookingId: 'b1',
          status: 'cancelled',
          cancelledBy: 'organizer',
          startAt: '2026-09-01T08:00:00.000Z',
        }),
        booking({
          bookingId: 'b2',
          status: 'cancelled',
          cancelledBy: 'organizer',
          startAt: '2026-09-05T08:00:00.000Z',
        }),
        booking({ bookingId: 'b3', startAt: '2026-09-12T08:00:00.000Z' }),
      ],
      new Set(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.current.bookingId).toBe('b3');
    expect(rows[0]!.state).toBe('confirmed');
    // Les créneaux tombés se COMPTENT au lieu de s'empiler.
    expect(rows[0]!.droppedSlots).toBe(2);
  });

  it('créneau tombé MAIS lien actif ⇒ « en attente », pas « annulé »', () => {
    const rows = groupByCandidature(
      [
        booking({ bookingId: 'b1', status: 'cancelled', cancelledBy: 'organizer' }),
      ],
      new Set(['can_1']),
    );
    expect(rows[0]!.state).toBe('awaiting_rebooking');
  });

  it('créneau tombé SANS relance ⇒ « annulé » : le seul cas qui appelle une action', () => {
    const rows = groupByCandidature(
      [booking({ bookingId: 'b1', status: 'cancelled', cancelledBy: 'attendee' })],
      new Set(),
    );
    expect(rows[0]!.state).toBe('cancelled');
    expect(rows[0]!.current.cancelledBy).toBe('attendee');
  });

  it('un rendez-vous confirmé l’emporte sur un lien encore actif', () => {
    // Le candidat a re-réservé avant que le lien précédent n'expire : c'est
    // l'état du rendez-vous qui fait foi, pas celui du lien.
    const rows = groupByCandidature(
      [
        booking({ bookingId: 'b1', status: 'cancelled', cancelledBy: 'organizer' }),
        booking({ bookingId: 'b2', startAt: '2026-09-20T08:00:00.000Z' }),
      ],
      new Set(['can_1']),
    );
    expect(rows[0]!.state).toBe('confirmed');
    expect(rows[0]!.current.bookingId).toBe('b2');
  });

  it('deux candidatures ⇒ deux lignes, jamais fusionnées', () => {
    const rows = groupByCandidature(
      [
        booking({ bookingId: 'b1', analysisId: 'can_1' }),
        booking({ bookingId: 'b2', analysisId: 'can_2' }),
      ],
      new Set(),
    );
    expect(rows).toHaveLength(2);
  });

  it('sans candidature, chaque réservation reste seule — on ne devine pas', () => {
    // Deux réservations sans contexte hôte pourraient appartenir à n'importe
    // qui : les rapprocher « parce qu'elles se ressemblent » serait pire que
    // de les laisser séparées.
    const rows = groupByCandidature(
      [
        booking({ bookingId: 'b1', analysisId: null, status: 'cancelled' }),
        booking({ bookingId: 'b2', analysisId: null, status: 'cancelled' }),
      ],
      new Set(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.state === 'cancelled')).toBe(true);
  });
});

describe('ordre d’affichage', () => {
  it('à venir d’abord (le plus proche), puis en attente, puis à traiter', () => {
    const rows = groupByCandidature(
      [
        booking({
          bookingId: 'annule',
          analysisId: 'can_x',
          status: 'cancelled',
          cancelledBy: 'attendee',
          startAt: '2026-09-02T08:00:00.000Z',
        }),
        booking({
          bookingId: 'attente',
          analysisId: 'can_y',
          status: 'cancelled',
          cancelledBy: 'organizer',
          startAt: '2026-09-03T08:00:00.000Z',
        }),
        booking({
          bookingId: 'loin',
          analysisId: 'can_z',
          startAt: '2026-09-30T08:00:00.000Z',
        }),
        booking({
          bookingId: 'proche',
          analysisId: 'can_w',
          startAt: '2026-09-11T08:00:00.000Z',
        }),
      ],
      new Set(['can_y']),
    );
    expect(rows.map((r) => r.current.bookingId)).toEqual([
      'proche',
      'loin',
      'attente',
      'annule',
    ]);
  });

  it('plusieurs créneaux tombés : c’est le PLUS RÉCENT qui représente la ligne', () => {
    const rows = groupByCandidature(
      [
        booking({
          bookingId: 'vieux',
          status: 'cancelled',
          startAt: '2026-09-01T08:00:00.000Z',
        }),
        booking({
          bookingId: 'recent',
          status: 'cancelled',
          startAt: '2026-09-06T08:00:00.000Z',
        }),
      ],
      new Set(),
    );
    expect(rows[0]!.current.bookingId).toBe('recent');
    expect(rows[0]!.droppedSlots).toBe(2);
  });
});
