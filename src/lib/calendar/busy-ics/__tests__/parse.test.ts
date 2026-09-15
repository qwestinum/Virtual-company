/**
 * Parseur d'agenda publié — tests PURS.
 *
 * Les instants UTC attendus sont écrits en dur, extraits du calendrier
 * Europe/Paris (CEST +02:00 jusqu'au 25/10/2026 03:00, CET +01:00 ensuite) :
 * un test qui recalculerait le décalage ne vérifierait que sa cohérence avec
 * lui-même. Tolérance zéro.
 */
import { describe, expect, it } from 'vitest';

import { MAX_OCCURRENCES_IN_WINDOW, parseBusyIcs, type BusyParseOptions } from '../parse';

const OPTIONS: BusyParseOptions = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-12-01T00:00:00.000Z',
  fallbackZone: 'Europe/Paris',
};

const ROMANCE_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Romance Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

function calendar(...blocks: string[][]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//FR', ...blocks.flat(), 'END:VCALENDAR', ''].join('\r\n');
}

function event(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

function parse(text: string, options: Partial<BusyParseOptions> = {}) {
  const result = parseBusyIcs(text, { ...OPTIONS, ...options });
  if (!result.ok) throw new Error(`échec inattendu: ${result.code}`);
  return result;
}

const iv = (startAt: string, endAt: string) => ({ startAt, endAt });

describe('parseBusyIcs — horaires et fuseaux', () => {
  it('prend tel quel un événement en UTC', () => {
    const r = parse(calendar(event('UID:a', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z')));
    expect(r.intervals).toEqual([iv('2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z')]);
    expect(r.occurrenceCount).toBe(1);
  });

  it('convertit un TZID Windows par son VTIMEZONE embarqué, 9h restant 9h de part et d’autre du changement d’heure', () => {
    const r = parse(
      calendar(
        ROMANCE_TZ,
        event(
          'UID:weekly',
          'DTSTART;TZID=Romance Standard Time:20261019T090000',
          'DTEND;TZID=Romance Standard Time:20261019T100000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
        ),
      ),
    );
    expect(r.intervals).toEqual([
      iv('2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      iv('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z'),
      iv('2026-11-02T08:00:00.000Z', '2026-11-02T09:00:00.000Z'),
    ]);
  });

  it('convertit un TZID IANA sans VTIMEZONE', () => {
    const r = parse(
      calendar(event('UID:b', 'DTSTART;TZID=Europe/Paris:20261021T140000', 'DTEND;TZID=Europe/Paris:20261021T150000')),
    );
    expect(r.intervals).toEqual([iv('2026-10-21T12:00:00.000Z', '2026-10-21T13:00:00.000Z')]);
    expect(r.tzAssumed).toBe(0);
  });

  it('garde un TZID inconnu dans le fuseau de repli, et le compte', () => {
    const r = parse(
      calendar(event('UID:c', 'DTSTART;TZID=Mars/Olympus:20261022T100000', 'DTEND;TZID=Mars/Olympus:20261022T110000')),
    );
    expect(r.intervals).toEqual([iv('2026-10-22T08:00:00.000Z', '2026-10-22T09:00:00.000Z')]);
    expect(r.tzAssumed).toBe(1);
  });

  it('lit une heure flottante dans le fuseau de repli, sans la compter comme inconnue', () => {
    const r = parse(calendar(event('UID:d', 'DTSTART:20261023T100000', 'DTEND:20261023T110000')));
    expect(r.intervals).toEqual([iv('2026-10-23T08:00:00.000Z', '2026-10-23T09:00:00.000Z')]);
    expect(r.tzAssumed).toBe(0);
  });

  it('retient la première occurrence d’une heure ambiguë (retour à l’heure d’hiver)', () => {
    // 25/10/2026, 02:30 existe deux fois à Paris : la première (CEST) = 00:30Z.
    // 03:30 n'existe qu'en CET = 02:30Z. Deux heures bloquées : sens prudent.
    const r = parse(
      calendar(event('UID:e', 'DTSTART;TZID=Europe/Paris:20261025T023000', 'DTEND;TZID=Europe/Paris:20261025T033000')),
    );
    expect(r.intervals).toEqual([iv('2026-10-25T00:30:00.000Z', '2026-10-25T02:30:00.000Z')]);
  });

  it('applique une DURATION', () => {
    const r = parse(calendar(event('UID:f', 'DTSTART:20261020T080000Z', 'DURATION:PT45M')));
    expect(r.intervals).toEqual([iv('2026-10-20T08:00:00.000Z', '2026-10-20T08:45:00.000Z')]);
  });

  it('ignore un événement date-heure sans fin (durée nulle, RFC 5545)', () => {
    expect(parse(calendar(event('UID:g', 'DTSTART:20261020T080000Z'))).intervals).toEqual([]);
  });
});

describe('parseBusyIcs — journées entières', () => {
  it('bloque la journée LOCALE du recruteur, pas une journée UTC', () => {
    const r = parse(calendar(event('UID:h', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261112')));
    expect(r.intervals).toEqual([iv('2026-11-10T23:00:00.000Z', '2026-11-11T23:00:00.000Z')]);
  });

  it('compte une journée de changement d’heure pour ses 25 heures', () => {
    const r = parse(calendar(event('UID:i', 'DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261026')));
    expect(r.intervals).toEqual([iv('2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z')]);
  });

  it('prend une journée quand la fin manque', () => {
    const r = parse(calendar(event('UID:j', 'DTSTART;VALUE=DATE:20261112')));
    expect(r.intervals).toEqual([iv('2026-11-11T23:00:00.000Z', '2026-11-12T23:00:00.000Z')]);
  });

  it('garde des journées civiles sur une récurrence qui traverse le changement d’heure', () => {
    const r = parse(
      calendar(event('UID:k', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'RRULE:FREQ=DAILY;COUNT=3')),
    );
    // Trois journées contiguës : fusionnées en une seule plage.
    expect(r.intervals).toEqual([iv('2026-10-23T22:00:00.000Z', '2026-10-26T23:00:00.000Z')]);
    expect(r.occurrenceCount).toBe(3);
  });
});

describe('parseBusyIcs — récurrences', () => {
  const weekly = (...extra: string[]) =>
    event(
      'UID:serie',
      'DTSTART;TZID=Europe/Paris:20261019T090000',
      'DTEND;TZID=Europe/Paris:20261019T100000',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      ...extra,
    );

  it('retire une occurrence EXDATE', () => {
    const r = parse(calendar(weekly('EXDATE;TZID=Europe/Paris:20261026T090000')));
    expect(r.intervals).toEqual([
      iv('2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      iv('2026-11-02T08:00:00.000Z', '2026-11-02T09:00:00.000Z'),
    ]);
  });

  it('remplace une occurrence déplacée (RECURRENCE-ID) au lieu de bloquer les deux horaires', () => {
    const r = parse(
      calendar(
        weekly(),
        event(
          'UID:serie',
          'RECURRENCE-ID;TZID=Europe/Paris:20261026T090000',
          'DTSTART;TZID=Europe/Paris:20261026T140000',
          'DTEND;TZID=Europe/Paris:20261026T150000',
        ),
      ),
    );
    expect(r.intervals).toEqual([
      iv('2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z'),
      iv('2026-10-26T13:00:00.000Z', '2026-10-26T14:00:00.000Z'),
      iv('2026-11-02T08:00:00.000Z', '2026-11-02T09:00:00.000Z'),
    ]);
  });

  it('libère une occurrence annulée par surcharge', () => {
    const r = parse(
      calendar(
        weekly(),
        event(
          'UID:serie',
          'RECURRENCE-ID;TZID=Europe/Paris:20261026T090000',
          'DTSTART;TZID=Europe/Paris:20261026T090000',
          'DTEND;TZID=Europe/Paris:20261026T100000',
          'STATUS:CANCELLED',
        ),
      ),
    );
    expect(r.intervals.map((i) => i.startAt)).toEqual([
      '2026-10-19T07:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
    ]);
  });

  it('borne une récurrence ancienne et sans fin à la fenêtre', () => {
    const r = parse(
      calendar(event('UID:ancienne', 'DTSTART:20160101T090000Z', 'DTEND:20160101T093000Z', 'RRULE:FREQ=DAILY')),
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z' },
    );
    expect(r.intervals).toEqual([
      iv('2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z'),
      iv('2026-10-02T09:00:00.000Z', '2026-10-02T09:30:00.000Z'),
    ]);
  });

  it('refuse un agenda dont une règle déborde : jamais une lecture partielle', () => {
    const r = parseBusyIcs(
      calendar(event('UID:folle', 'DTSTART:20261001T000000Z', 'DURATION:PT30S', 'RRULE:FREQ=MINUTELY')),
      OPTIONS,
    );
    expect(r).toEqual({ ok: false, code: 'recurrence_overflow' });
    expect(MAX_OCCURRENCES_IN_WINDOW).toBe(2000);
  });
});

describe('parseBusyIcs — ce qui bloque et ce qui ne bloque pas', () => {
  const slot = ['DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z'];
  const busyOf = (...lines: string[]) => parse(calendar(event('UID:s', ...slot, ...lines))).intervals.length;

  it('ignore un événement annulé', () => expect(busyOf('STATUS:CANCELLED')).toBe(0));
  it('ignore un événement « disponible » (TRANSP)', () => expect(busyOf('TRANSP:TRANSPARENT')).toBe(0));
  it('ignore « disponible » au sens Outlook', () => expect(busyOf('X-MICROSOFT-CDO-BUSYSTATUS:FREE')).toBe(0));
  it('ignore « travail ailleurs »', () => expect(busyOf('X-MICROSOFT-CDO-BUSYSTATUS:WORKINGELSEWHERE')).toBe(0));
  it('bloque « provisoire »', () => expect(busyOf('X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE')).toBe(1));
  it('bloque « absent »', () => expect(busyOf('X-MICROSOFT-CDO-BUSYSTATUS:OOF')).toBe(1));
  it('fait primer le statut Outlook sur TRANSP', () =>
    expect(busyOf('X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE', 'TRANSP:TRANSPARENT')).toBe(1));
  it('bloque par défaut', () => expect(busyOf()).toBe(1));
});

describe('parseBusyIcs — intervalles', () => {
  it('fusionne ce qui se chevauche ou se touche, et découpe à la fenêtre', () => {
    const r = parse(
      calendar(
        event('UID:1', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z'),
        event('UID:2', 'DTSTART:20261020T083000Z', 'DTEND:20261020T100000Z'),
        event('UID:3', 'DTSTART:20261020T100000Z', 'DTEND:20261020T103000Z'),
        event('UID:4', 'DTSTART:20260930T230000Z', 'DTEND:20261001T010000Z'),
        event('UID:5', 'DTSTART:20270101T080000Z', 'DTEND:20270101T090000Z'),
      ),
    );
    expect(r.intervals).toEqual([
      iv('2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z'),
      iv('2026-10-20T08:00:00.000Z', '2026-10-20T10:30:00.000Z'),
    ]);
  });
});

describe('parseBusyIcs — documents', () => {
  it('accepte un agenda VIDE : c’est un cas valide, pas une panne', () => {
    expect(parseBusyIcs(calendar(), OPTIONS)).toEqual({
      ok: true,
      intervals: [],
      occurrenceCount: 0,
      tzAssumed: 0,
      carriesDetails: false,
    });
  });

  it('refuse ce qui n’est pas un calendrier', () => {
    expect(parseBusyIcs('<!DOCTYPE html><html></html>', OPTIONS)).toEqual({ ok: false, code: 'parse_error' });
    expect(parseBusyIcs('BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n', OPTIONS)).toEqual({
      ok: false,
      code: 'parse_error',
    });
  });

  it('refuse un document tronqué', () => {
    const cut = calendar(event('UID:t', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z')).slice(0, 90);
    expect(parseBusyIcs(cut, OPTIONS)).toEqual({ ok: false, code: 'parse_error' });
  });

  it('lit un flux Outlook « disponibilités uniquement » (forme mesurée le 15/09)', () => {
    const r = parse(
      calendar(
        ROMANCE_TZ,
        event(
          'CLASS:PUBLIC',
          'DTSTART;TZID=Romance Standard Time:20261020T140000',
          'DTEND;TZID=Romance Standard Time:20261020T153000',
          'PRIORITY:5',
          'SUMMARY;LANGUAGE=fr-FR:Occupé(e)',
          'TRANSP:OPAQUE',
          'UID:040000008200E00074C5B7101A82E00800000000',
          'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
        ),
      ),
    );
    expect(r.intervals).toEqual([iv('2026-10-20T12:00:00.000Z', '2026-10-20T13:30:00.000Z')]);
    expect(r.carriesDetails).toBe(false);
  });
});

describe('parseBusyIcs — aucune donnée de rendez-vous ne sort', () => {
  // Export Google COMPLET (adresse secrète) : chaque valeur interdite porte un
  // marqueur. Seules des bornes doivent traverser la fonction.
  const GOOGLE_FULL = calendar(
    [
      'X-WR-CALNAME:SECRET-CALNAME',
      'X-WR-CALDESC:SECRET-CALDESC',
      'X-WR-TIMEZONE:Europe/Paris',
    ],
    event(
      'DTSTART:20261020T080000Z',
      'DTEND:20261020T090000Z',
      'UID:SECRET-UID@google.com',
      'ORGANIZER;CN=SECRET-ORGANIZER:mailto:secret-organizer@exemple.test',
      'ATTENDEE;CN=SECRET-ATTENDEE;PARTSTAT=ACCEPTED:mailto:secret-attendee@exemple.test',
      'DESCRIPTION:SECRET-DESCRIPTION confidentielle',
      'LOCATION:SECRET-LOCATION 12 rue Exemple',
      'SUMMARY:SECRET-SUMMARY Entretien annuel',
      'ATTACH:https://drive.exemple.test/SECRET-ATTACH',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
    ),
  );

  it('ne restitue aucun titre, participant, lieu ni description', () => {
    const result = parseBusyIcs(GOOGLE_FULL, OPTIONS);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/SECRET/i);
    expect(serialized).not.toContain('exemple.test');
    expect(result).toEqual({
      ok: true,
      intervals: [iv('2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z')],
      occurrenceCount: 1,
      tzAssumed: 0,
      carriesDetails: true,
    });
  });

  it('ne restitue rien non plus en cas d’échec', () => {
    const broken = GOOGLE_FULL.replace('END:VCALENDAR', '');
    expect(JSON.stringify(parseBusyIcs(broken, OPTIONS))).not.toMatch(/SECRET/i);
  });
});
