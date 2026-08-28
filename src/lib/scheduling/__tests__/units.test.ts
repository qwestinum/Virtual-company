/**
 * Petites pièces pures : verdict de conflit, résolution du lieu, jetons.
 *
 * Ce sont des décisions à une ligne, mais chacune arbitre un cas où se tromper
 * coûte cher : dire « créneau pris » pour une autre raison, envoyer quelqu'un
 * au mauvais endroit, ou produire un jeton devinable.
 */
import { describe, expect, it } from 'vitest';

import { isSlotClaimConflict, isUniqueViolation } from '../errors';
import {
  describeMeetingLocation,
  isMeetingLocationComplete,
  parseMeetingLocation,
  resolveMeetingLocation,
} from '../meeting-location';
import { toBooking, type BookingRow } from '../rows';
import { generateToken, isTokenShaped } from '../tokens';

describe('isSlotClaimConflict', () => {
  const slotConflict = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "sched_bookings_slot_claim_idx"',
    details: 'Key (resource_id, start_at)=(…) already exists.',
  };

  it('reconnaît la course sur le créneau', () => {
    expect(isSlotClaimConflict(slotConflict)).toBe(true);
  });

  it('ignore ce qui n’est pas une violation d’unicité', () => {
    expect(isSlotClaimConflict({ code: '23503', message: 'foreign key' })).toBe(false);
    expect(isSlotClaimConflict(null)).toBe(false);
  });

  it('REFUSE de confondre le conflit de jeton de gestion avec un créneau pris', () => {
    // Le piège qui a mordu : reporter le jeton lors d'un déplacement heurtait
    // son propre index d'unicité, et l'appelant lisait « créneau déjà pris ».
    expect(
      isSlotClaimConflict({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "sched_bookings_manage_token_confirmed_idx"',
        details: 'Key (manage_token)=(…) already exists.',
      }),
    ).toBe(false);
  });

  it('reste prudent quand Postgres ne nomme aucune contrainte connue', () => {
    // Par défaut on répond « course sur le créneau » : transformer une vraie
    // course en erreur serait pire que l'inverse.
    expect(isSlotClaimConflict({ code: '23505', message: 'duplicate key' })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
});

describe('resolveMeetingLocation', () => {
  const video = { type: 'video', payload: { url: 'https://visio/1' } } as const;
  const office = { type: 'in_person', payload: { address: '1 rue A' } } as const;

  it('fait primer la surcharge de la cible sur le défaut de la ressource', () => {
    expect(
      resolveMeetingLocation({ resourceDefault: video, targetOverride: office }),
    ).toEqual(office);
  });

  it('retombe sur le défaut de la ressource', () => {
    expect(
      resolveMeetingLocation({ resourceDefault: video, targetOverride: null }),
    ).toEqual(video);
  });

  it('accepte l’absence totale de lieu', () => {
    expect(
      resolveMeetingLocation({ resourceDefault: null, targetOverride: null }),
    ).toBeNull();
  });
});

describe('isMeetingLocationComplete', () => {
  it('un type sans son détail n’est pas un lieu', () => {
    // Le cas réel : « Par téléphone » choisi, consigne jamais saisie. Il
    // s'enregistrait, se relisait comme « aucun lieu », et on retombait en
    // silence sur le lien de visioconférence du référent.
    expect(isMeetingLocationComplete({ type: 'phone', payload: { instructions: '' } })).toBe(
      false,
    );
    expect(isMeetingLocationComplete({ type: 'phone', payload: { instructions: '   ' } })).toBe(
      false,
    );
    expect(isMeetingLocationComplete({ type: 'video', payload: { url: '' } })).toBe(false);
    expect(isMeetingLocationComplete({ type: 'in_person', payload: { address: '' } })).toBe(
      false,
    );
  });

  it('accepte les trois formes renseignées', () => {
    expect(
      isMeetingLocationComplete({ type: 'video', payload: { url: 'https://visio/1' } }),
    ).toBe(true);
    expect(
      isMeetingLocationComplete({ type: 'in_person', payload: { address: '1 rue A' } }),
    ).toBe(true);
    expect(
      isMeetingLocationComplete({ type: 'phone', payload: { instructions: 'On vous appelle.' } }),
    ).toBe(true);
  });

  it('« aucun lieu » n’est pas complet — et c’est ce qui bloque l’invitation', () => {
    expect(isMeetingLocationComplete(null)).toBe(false);
  });

  it('dit la MÊME chose que la relecture, sur toutes les formes', () => {
    // L'invariant qui manquait : ce que l'écran juge acceptable et ce que la
    // base rendra doivent coïncider. Tant qu'ils divergeaient, un lieu pouvait
    // s'enregistrer puis disparaître sans un mot.
    const cases = [
      { type: 'video', payload: { url: '' } },
      { type: 'video', payload: { url: 'https://a' } },
      { type: 'in_person', payload: { address: '  ' } },
      { type: 'in_person', payload: { address: '1 rue A' } },
      { type: 'phone', payload: { instructions: '' } },
      { type: 'phone', payload: { instructions: 'On vous appelle.' } },
    ] as const;
    for (const value of cases) {
      expect(isMeetingLocationComplete(value)).toBe(parseMeetingLocation(value) !== null);
    }
  });
});

describe('parseMeetingLocation', () => {
  it('accepte les trois formes et normalise les espaces', () => {
    expect(parseMeetingLocation({ type: 'video', payload: { url: ' https://a ' } })).toEqual({
      type: 'video',
      payload: { url: 'https://a' },
    });
    expect(
      parseMeetingLocation({ type: 'in_person', payload: { address: '2 rue B' } }),
    ).toEqual({ type: 'in_person', payload: { address: '2 rue B' } });
    expect(
      parseMeetingLocation({ type: 'phone', payload: { instructions: 'on vous appelle' } }),
    ).toEqual({ type: 'phone', payload: { instructions: 'on vous appelle' } });
  });

  it('rejette ce qui n’est pas un lieu exploitable', () => {
    expect(parseMeetingLocation(null)).toBeNull();
    expect(parseMeetingLocation({ type: 'hologramme', payload: {} })).toBeNull();
    expect(parseMeetingLocation({ type: 'video', payload: { url: '   ' } })).toBeNull();
    expect(parseMeetingLocation({ type: 'video' })).toBeNull();
  });

  it('n’interprète jamais le contenu d’une URL', () => {
    // Aucune logique par fournisseur : une URL vaut une autre.
    const exotic = { type: 'video', payload: { url: 'https://interne.local/salle-42' } };
    expect(parseMeetingLocation(exotic)).toEqual(exotic);
  });
});

describe('describeMeetingLocation', () => {
  it('rend le fait, sans mise en forme', () => {
    expect(
      describeMeetingLocation({ type: 'phone', payload: { instructions: 'on vous appelle' } }),
    ).toBe('on vous appelle');
    expect(describeMeetingLocation(null)).toBeNull();
  });
});

describe('horodatages rendus par le module', () => {
  /** Ligne telle que Postgres la rend : décalage `+00:00`, sans millisecondes. */
  const row: BookingRow = {
    id: 'b1',
    link_token: 't1',
    target_id: 'tg1',
    resource_id: 'r1',
    start_at: '2026-08-17T14:00:00+00:00',
    end_at: '2026-08-17T14:45:00+00:00',
    status: 'confirmed',
    cancelled_by: null,
    cancelled_reason: null,
    cancelled_at: null,
    rescheduled_from: null,
    attendee_name: 'A',
    attendee_email: 'a@exemple.test',
    attendee_phone: null,
    attendee_timezone: 'Europe/Paris',
    context: { libre: true },
    meeting_location: null,
    manage_token: 'm1',
    created_at: '2026-08-17T09:30:00+00:00',
  };

  it('rend un ISO UTC canonique, comparable au moteur de créneaux', () => {
    // Le moteur produit `…T14:00:00.000Z`. Sans normalisation, un appelant qui
    // rapproche un créneau proposé d'une réservation par égalité de chaînes ne
    // trouverait rien, alors que c'est le même instant.
    const booking = toBooking(row, {
      targetExternalRef: 'TG',
      resourceExternalRef: 'R',
    });
    expect(booking.startAt).toBe('2026-08-17T14:00:00.000Z');
    expect(booking.endAt).toBe('2026-08-17T14:45:00.000Z');
    expect(booking.createdAt).toBe('2026-08-17T09:30:00.000Z');
    expect(booking.cancelledAt).toBeNull();
  });

  it('conserve les champs opaques sans y toucher', () => {
    const booking = toBooking(row, {
      targetExternalRef: 'TG',
      resourceExternalRef: 'R',
    });
    expect(booking.context).toEqual({ libre: true });
  });
});

describe('jetons', () => {
  it('produit des jetons de 128 bits en base64url', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isTokenShaped(token)).toBe(true);
  });

  it('ne répète pas un jeton', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });

  it('écarte ce qui ne peut pas être un jeton, sans aller en base', () => {
    expect(isTokenShaped('')).toBe(false);
    expect(isTokenShaped('court')).toBe(false);
    expect(isTokenShaped('avec des espaces et des accents é')).toBe(false);
    expect(isTokenShaped('../../etc/passwd')).toBe(false);
  });
});
