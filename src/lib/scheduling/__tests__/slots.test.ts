/**
 * Moteur de créneaux — tests PURS (aucune base, aucune horloge réelle).
 *
 * Les valeurs UTC attendues sont écrites en dur, jamais recalculées par le
 * test : un test qui refait le calcul du code ne vérifie que sa cohérence avec
 * lui-même. Elles ont été extraites du calendrier Europe/Paris.
 *
 * Le fil rouge des cas de changement d'heure : l'HEURE MURALE DÉCLARÉE est ce
 * qui doit rester stable. « 9h00 » vaut 9h00 des deux côtés d'une transition —
 * c'est l'instant UTC qui bouge, et c'est normal.
 */
import { describe, expect, it } from 'vitest';

import { computeSlots, findOfferedSlot, type SlotEngineInput } from '../slots';

const PARIS = 'Europe/Paris';

/** Semaine ouvrée 9h-12h, entretiens de 45 min avec 15 min de battement. */
function baseInput(overrides: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {
    timezone: PARIS,
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 60,
    rules: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: 9 * 60,
      endMinute: 12 * 60,
    })),
    exceptions: [],
    busy: [],
    from: '2026-09-07T00:00:00.000Z',
    to: '2026-09-07T23:59:59.000Z',
    now: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const startsOf = (input: SlotEngineInput): string[] =>
  computeSlots(input).map((slot) => slot.startAt);

describe('computeSlots — cas nominaux', () => {
  it('découpe une plage en créneaux espacés de la durée + le battement', () => {
    // Lundi 7 septembre 2026, 9h-12h à Paris (CEST, +02:00) : 9h00, 10h00,
    // 11h00. Pas de 4e créneau — 12h00 + 45 min déborderait la plage.
    expect(startsOf(baseInput())).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);
  });

  it('rend une liste vide un jour sans règle (samedi)', () => {
    expect(
      startsOf(
        baseInput({
          from: '2026-09-12T00:00:00.000Z',
          to: '2026-09-12T23:59:59.000Z',
        }),
      ),
    ).toEqual([]);
  });

  it('gère plusieurs plages le même jour', () => {
    const input = baseInput({
      rules: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
        { weekday: 1, startMinute: 14 * 60, endMinute: 17 * 60 },
      ],
    });
    expect(startsOf(input)).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
      '2026-09-07T12:00:00.000Z',
      '2026-09-07T13:00:00.000Z',
      '2026-09-07T14:00:00.000Z',
    ]);
  });

  it('ne produit jamais deux fois le même créneau quand des règles se recouvrent', () => {
    const input = baseInput({
      rules: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 },
      ],
    });
    const starts = startsOf(input);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);
  });
});

describe('computeSlots — exceptions', () => {
  it('vide la journée sur une exception sans horaires (congé)', () => {
    const input = baseInput({
      exceptions: [
        { id: 'e1', day: '2026-09-07', startMinute: null, endMinute: null, label: 'Congé' },
      ],
    });
    expect(startsOf(input)).toEqual([]);
  });

  it('retranche une plage partielle et garde le reste', () => {
    // 10h00-11h00 bloqué : le créneau de 10h00 tombe, 9h00 et 11h00 restent.
    const input = baseInput({
      exceptions: [
        { id: 'e2', day: '2026-09-07', startMinute: 10 * 60, endMinute: 11 * 60, label: null },
      ],
    });
    expect(startsOf(input)).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);
  });

  it("n'applique une exception qu'à sa propre date", () => {
    const input = baseInput({
      exceptions: [
        { id: 'e3', day: '2026-09-08', startMinute: null, endMinute: null, label: null },
      ],
    });
    expect(startsOf(input)).toHaveLength(3);
  });
});

describe('computeSlots — réservations existantes et battement', () => {
  it('écarte un créneau déjà réservé', () => {
    const input = baseInput({
      busy: [
        { startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T08:45:00.000Z' },
      ],
    });
    expect(startsOf(input)).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);
  });

  it('écarte aussi les créneaux COLLÉS à un rendez-vous, à hauteur du battement', () => {
    // Un RDV de 9h30 à 10h15 (heure de Paris) ne bloque pas seulement son
    // horaire : avec 15 min de battement, les créneaux de 9h00 et 10h00 sont
    // trop proches. C'est la mitigation du risque « salle visio partagée ».
    const input = baseInput({
      busy: [
        { startAt: '2026-09-07T07:30:00.000Z', endAt: '2026-09-07T08:15:00.000Z' },
      ],
    });
    expect(startsOf(input)).toEqual(['2026-09-07T09:00:00.000Z']);
  });

  it('sans battement, un créneau peut suivre immédiatement un rendez-vous', () => {
    const input = baseInput({
      bufferMinutes: 0,
      busy: [
        { startAt: '2026-09-07T07:00:00.000Z', endAt: '2026-09-07T07:45:00.000Z' },
      ],
    });
    // Pas = 45 min sans battement : 9h00 (pris), 9h45, 10h30, 11h15.
    expect(startsOf(input)).toEqual([
      '2026-09-07T07:45:00.000Z',
      '2026-09-07T08:30:00.000Z',
      '2026-09-07T09:15:00.000Z',
    ]);
  });
});

describe('computeSlots — préavis et horizon', () => {
  it('repousse le début du préavis minimum', () => {
    // 24 h de préavis depuis lundi 7 à 08h00 UTC : les créneaux du lendemain
    // avant 08h00 UTC tombent.
    const input = baseInput({
      minNoticeMinutes: 24 * 60,
      now: '2026-09-07T08:00:00.000Z',
      from: '2026-09-08T00:00:00.000Z',
      to: '2026-09-08T23:59:59.000Z',
    });
    expect(startsOf(input)).toEqual([
      '2026-09-08T08:00:00.000Z',
      '2026-09-08T09:00:00.000Z',
    ]);
  });

  it("coupe à l'horizon de réservation", () => {
    const input = baseInput({
      horizonDays: 2,
      now: '2026-09-07T00:00:00.000Z',
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-30T23:59:59.000Z',
    });
    const starts = startsOf(input);
    expect(starts.at(0)).toBe('2026-09-07T07:00:00.000Z');
    expect(starts.every((s) => s <= '2026-09-09T00:00:00.000Z')).toBe(true);
  });

  it('rend une liste vide quand le préavis dépasse la fenêtre', () => {
    expect(startsOf(baseInput({ minNoticeMinutes: 60 * 24 * 30 }))).toEqual([]);
  });
});

describe('computeSlots — changement d’heure Europe/Paris', () => {
  // Transitions RÉELLES : derniers dimanches de mois.
  //   25/10/2026 — retour à l'heure d'hiver (03:00 CEST → 02:00 CET) ;
  //   28/03/2027 — passage à l'heure d'été  (02:00 CET → 03:00 CEST).
  // Les lendemains sont testés aussi : c'est là qu'une implémentation naïve
  // (ajout de 24 h en millisecondes) dérive d'une heure sans le dire.
  const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 12 * 60,
  }));

  const dayStarts = (day: string, now: string): string[] =>
    startsOf(
      baseInput({
        rules: everyDay,
        now,
        from: `${day}T00:00:00.000Z`,
        to: `${day}T23:59:59.000Z`,
      }),
    );

  it('garde 9h00 locales la veille et le jour du retour à l’heure d’hiver', () => {
    // 24/10 en CEST (+02:00) ⇒ 07:00Z ; 25/10 en CET (+01:00) ⇒ 08:00Z.
    // L'instant change, l'heure affichée au candidat ne bouge pas.
    expect(dayStarts('2026-10-24', '2026-10-01T00:00:00.000Z')).toEqual([
      '2026-10-24T07:00:00.000Z',
      '2026-10-24T08:00:00.000Z',
      '2026-10-24T09:00:00.000Z',
    ]);
    expect(dayStarts('2026-10-25', '2026-10-01T00:00:00.000Z')).toEqual([
      '2026-10-25T08:00:00.000Z',
      '2026-10-25T09:00:00.000Z',
      '2026-10-25T10:00:00.000Z',
    ]);
  });

  it('ne dérive pas le LENDEMAIN du retour à l’heure d’hiver', () => {
    expect(dayStarts('2026-10-26', '2026-10-01T00:00:00.000Z')).toEqual([
      '2026-10-26T08:00:00.000Z',
      '2026-10-26T09:00:00.000Z',
      '2026-10-26T10:00:00.000Z',
    ]);
  });

  it('garde 9h00 locales la veille et le jour du passage à l’heure d’été', () => {
    // 27/03 en CET (+01:00) ⇒ 08:00Z ; 28/03 en CEST (+02:00) ⇒ 07:00Z.
    expect(dayStarts('2027-03-27', '2027-03-01T00:00:00.000Z')).toEqual([
      '2027-03-27T08:00:00.000Z',
      '2027-03-27T09:00:00.000Z',
      '2027-03-27T10:00:00.000Z',
    ]);
    expect(dayStarts('2027-03-28', '2027-03-01T00:00:00.000Z')).toEqual([
      '2027-03-28T07:00:00.000Z',
      '2027-03-28T08:00:00.000Z',
      '2027-03-28T09:00:00.000Z',
    ]);
  });

  it('ne dérive pas le LENDEMAIN du passage à l’heure d’été', () => {
    expect(dayStarts('2027-03-29', '2027-03-01T00:00:00.000Z')).toEqual([
      '2027-03-29T07:00:00.000Z',
      '2027-03-29T08:00:00.000Z',
      '2027-03-29T09:00:00.000Z',
    ]);
  });

  it('écarte une heure locale qui n’existe pas (nuit du passage à l’heure d’été)', () => {
    // Règle 02:00-04:00 le dimanche. Le 28/03/2027, 02:00 locales n'existent
    // pas : ce créneau est ÉCARTÉ, pas décalé en silence à 03:00. Seul 03:00
    // subsiste. Le dimanche précédent, la même règle rend bien deux créneaux.
    const nightRule = (day: string): string[] =>
      startsOf(
        baseInput({
          slotDurationMinutes: 60,
          bufferMinutes: 0,
          rules: [{ weekday: 7, startMinute: 2 * 60, endMinute: 4 * 60 }],
          now: '2027-03-01T00:00:00.000Z',
          from: `${day}T00:00:00.000Z`,
          to: `${day}T23:59:59.000Z`,
        }),
      );

    expect(nightRule('2027-03-21')).toEqual([
      '2027-03-21T01:00:00.000Z',
      '2027-03-21T02:00:00.000Z',
    ]);
    expect(nightRule('2027-03-28')).toEqual(['2027-03-28T01:00:00.000Z']);
  });

  it('retient la PREMIÈRE occurrence d’une heure locale ambiguë', () => {
    // Le 25/10/2026, 02:00-02:59 locales arrivent deux fois. On retient la
    // première (encore en CEST, +02:00 ⇒ 00:00Z) — déterministe et documenté.
    const starts = startsOf(
      baseInput({
        slotDurationMinutes: 60,
        bufferMinutes: 0,
        rules: [{ weekday: 7, startMinute: 2 * 60, endMinute: 4 * 60 }],
        now: '2026-10-01T00:00:00.000Z',
        from: '2026-10-25T00:00:00.000Z',
        to: '2026-10-25T23:59:59.000Z',
      }),
    );
    expect(starts).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
    ]);
  });
});

describe('findOfferedSlot', () => {
  it('retrouve un créneau offert à la seconde près', () => {
    const slot = findOfferedSlot(baseInput(), '2026-09-07T08:00:00.000Z');
    expect(slot).toEqual({
      startAt: '2026-09-07T08:00:00.000Z',
      endAt: '2026-09-07T08:45:00.000Z',
    });
  });

  it('refuse un horaire proche mais non offert', () => {
    expect(findOfferedSlot(baseInput(), '2026-09-07T08:15:00.000Z')).toBeNull();
  });

  it('refuse un créneau devenu indisponible', () => {
    const input = baseInput({
      busy: [
        { startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T08:45:00.000Z' },
      ],
    });
    expect(findOfferedSlot(input, '2026-09-07T08:00:00.000Z')).toBeNull();
  });
});

describe('computeSlots — garde-fous', () => {
  it('refuse un fuseau inconnu plutôt que de deviner', () => {
    expect(() => computeSlots(baseInput({ timezone: 'Mars/Olympus' }))).toThrow(
      /invalid_timezone/,
    );
  });

  it('respecte un fuseau non européen', () => {
    // Montréal (EDT, -04:00) en septembre : 9h00 locales ⇒ 13:00Z.
    const starts = startsOf(
      baseInput({
        timezone: 'America/Montreal',
        from: '2026-09-07T00:00:00.000Z',
        to: '2026-09-08T03:59:59.000Z',
      }),
    );
    expect(starts.at(0)).toBe('2026-09-07T13:00:00.000Z');
  });
});
