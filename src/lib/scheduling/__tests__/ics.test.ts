/**
 * Invitation d'agenda — tests PURS.
 *
 * On analyse le fichier produit plutôt que de comparer une chaîne entière :
 * un test qui fige le texte complet casse au premier ajout de propriété, sans
 * rien dire de ce qui compte. Ce qui compte ici, c'est ce dont dépendent les
 * clients d'agenda pour décider de créer, remplacer ou retirer un événement.
 */
import { describe, expect, it } from 'vitest';

import { buildBookingIcs, icsContentType, icsMethodFor } from '../ics';

const BASE = {
  uid: 'root-booking-id',
  sequence: 0,
  startAt: '2026-09-07T07:00:00.000Z',
  endAt: '2026-09-07T07:45:00.000Z',
  summary: 'Rendez-vous — Cabinet Démo',
  stampAt: '2026-09-01T10:00:00.000Z',
  location: null,
  attendee: { name: 'Alex Martin', email: 'alex@exemple.test' },
};

/** Déplie les lignes (RFC 5545) puis indexe par nom de propriété. */
function parseIcs(content: string): Map<string, string[]> {
  const unfolded = content.replace(/\r\n[ \t]/g, '');
  const map = new Map<string, string[]>();
  for (const line of unfolded.split('\r\n')) {
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const rawName = line.slice(0, separator);
    const name = rawName.split(';')[0] as string;
    const value = line.slice(separator + 1);
    const existing = map.get(name);
    if (existing) existing.push(`${rawName}:${value}`);
    else map.set(name, [`${rawName}:${value}`]);
  }
  return map;
}

const valueOf = (ics: Map<string, string[]>, name: string): string =>
  (ics.get(name)?.[0] ?? '').slice((ics.get(name)?.[0] ?? '').indexOf(':') + 1);

describe('buildBookingIcs — structure', () => {
  it('produit un événement complet, en CRLF', () => {
    const content = buildBookingIcs(BASE) as string;
    expect(content).toContain('\r\n');
    expect(content.endsWith('\r\n')).toBe(true);

    const ics = parseIcs(content);
    expect(valueOf(ics, 'BEGIN')).toBe('VCALENDAR');
    expect(valueOf(ics, 'UID')).toBe('root-booking-id@scheduling.invalid');
    expect(valueOf(ics, 'DTSTART')).toBe('20260907T070000Z');
    expect(valueOf(ics, 'DTEND')).toBe('20260907T074500Z');
    expect(valueOf(ics, 'SEQUENCE')).toBe('0');
    expect(valueOf(ics, 'STATUS')).toBe('CONFIRMED');
  });

  it('utilise le domaine fourni par l’installation', () => {
    const ics = parseIcs(buildBookingIcs({ ...BASE, domain: 'demo.local' }) as string);
    expect(valueOf(ics, 'UID')).toBe('root-booking-id@demo.local');
  });

  it('refuse une date de début illisible plutôt que d’inventer', () => {
    expect(buildBookingIcs({ ...BASE, startAt: 'pas une date' })).toBeNull();
  });

  it('plie les lignes trop longues et les rend relisibles', () => {
    const longSummary = `Rendez-vous ${'très '.repeat(40)}long`;
    const content = buildBookingIcs({ ...BASE, summary: longSummary }) as string;
    for (const line of content.split('\r\n')) {
      expect(Array.from(line).length).toBeLessThanOrEqual(75);
    }
    expect(valueOf(parseIcs(content), 'SUMMARY')).toBe(longSummary);
  });

  it('échappe les métacaractères du texte', () => {
    const content = buildBookingIcs({
      ...BASE,
      summary: 'Point; virgule, et\nretour',
    }) as string;
    expect(content).toContain('SUMMARY:Point\\; virgule\\, et\\nretour');
  });
});

describe('buildBookingIcs — invitation ou simple ajout', () => {
  it('sans organisateur : PUBLISH, et personne à qui répondre', () => {
    const ics = parseIcs(buildBookingIcs(BASE) as string);
    expect(valueOf(ics, 'METHOD')).toBe('PUBLISH');
    expect(ics.has('ORGANIZER')).toBe(false);
  });

  it('avec organisateur : REQUEST, et aucune réponse réclamée', () => {
    const content = buildBookingIcs({
      ...BASE,
      organizer: { name: 'Camille', email: 'camille@exemple.test' },
    }) as string;
    const ics = parseIcs(content);
    expect(valueOf(ics, 'METHOD')).toBe('REQUEST');
    expect(ics.get('ORGANIZER')?.[0]).toContain('mailto:camille@exemple.test');
    // RSVP=FALSE : on informe, on ne demande pas une réponse que personne ne lit.
    expect(ics.get('ATTENDEE')?.[0]).toContain('RSVP=FALSE');
    expect(ics.get('ATTENDEE')?.[0]).toContain('mailto:alex@exemple.test');
  });

  it('annulation : CANCEL et statut annulé', () => {
    const ics = parseIcs(
      buildBookingIcs({
        ...BASE,
        sequence: 2,
        cancelled: true,
        organizer: { name: 'Camille', email: 'camille@exemple.test' },
      }) as string,
    );
    expect(valueOf(ics, 'METHOD')).toBe('CANCEL');
    expect(valueOf(ics, 'STATUS')).toBe('CANCELLED');
    expect(valueOf(ics, 'SEQUENCE')).toBe('2');
  });
});

describe('buildBookingIcs — lieu de rencontre', () => {
  it('porte l’URL en visioconférence', () => {
    const ics = parseIcs(
      buildBookingIcs({
        ...BASE,
        location: { type: 'video', payload: { url: 'https://visio.test/salle' } },
      }) as string,
    );
    expect(valueOf(ics, 'LOCATION')).toBe('https://visio.test/salle');
  });

  it('porte l’adresse en présentiel, échappée', () => {
    const ics = parseIcs(
      buildBookingIcs({
        ...BASE,
        location: { type: 'in_person', payload: { address: '2 rue A, 75001 Paris' } },
      }) as string,
    );
    expect(valueOf(ics, 'LOCATION')).toBe('2 rue A\\, 75001 Paris');
  });

  it('porte la consigne au téléphone', () => {
    const ics = parseIcs(
      buildBookingIcs({
        ...BASE,
        location: { type: 'phone', payload: { instructions: 'Nous vous appelons' } },
      }) as string,
    );
    expect(valueOf(ics, 'LOCATION')).toBe('Nous vous appelons');
  });

  it('omet la ligne quand aucun lieu n’est renseigné', () => {
    expect(parseIcs(buildBookingIcs(BASE) as string).has('LOCATION')).toBe(false);
  });
});

describe('type MIME', () => {
  it('porte la méthode — sans elle, c’est une pièce jointe ordinaire', () => {
    expect(icsContentType('REQUEST')).toBe('text/calendar; charset=utf-8; method=REQUEST');
    expect(icsContentType('CANCEL')).toBe('text/calendar; charset=utf-8; method=CANCEL');
  });

  it('déduit la méthode comme le générateur', () => {
    expect(icsMethodFor({ hasOrganizer: true })).toBe('REQUEST');
    expect(icsMethodFor({ hasOrganizer: false })).toBe('PUBLISH');
    expect(icsMethodFor({ hasOrganizer: true, cancelled: true })).toBe('CANCEL');
  });
});
