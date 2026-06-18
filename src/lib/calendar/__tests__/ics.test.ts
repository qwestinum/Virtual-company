import { describe, expect, it } from 'vitest';

import { buildInterviewIcs } from '@/lib/calendar/ics';

const base = {
  bookingUid: 'bk_1',
  startAt: '2026-06-23T12:00:00.000Z',
  endAt: '2026-06-23T12:30:00.000Z',
  summary: 'Entretien — Jane Doe (Data Engineer)',
  description: 'Profil solide.',
  location: 'Google Meet',
  stampAt: '2026-06-18T10:00:00.000Z',
};

describe('buildInterviewIcs', () => {
  it('produit un VCALENDAR/VEVENT valide avec dates UTC et CRLF', () => {
    const ics = buildInterviewIcs(base)!;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:bk_1@orqa.qwestinum');
    expect(ics).toContain('DTSTART:20260623T120000Z');
    expect(ics).toContain('DTEND:20260623T123000Z');
    expect(ics).toContain('DTSTAMP:20260618T100000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('\r\n'); // CRLF requis
  });

  it('déduit une fin à +30 min quand endAt est absent', () => {
    const ics = buildInterviewIcs({ ...base, endAt: null })!;
    expect(ics).toContain('DTSTART:20260623T120000Z');
    expect(ics).toContain('DTEND:20260623T123000Z');
  });

  it('échappe les métacaractères iCalendar (virgule, point-virgule, retour ligne)', () => {
    const ics = buildInterviewIcs({
      ...base,
      summary: 'Entretien; Dev, Senior',
      description: 'Ligne 1\nLigne 2',
    })!;
    expect(ics).toContain('SUMMARY:Entretien\\; Dev\\, Senior');
    expect(ics).toContain('DESCRIPTION:Ligne 1\\nLigne 2');
  });

  it('omet DESCRIPTION et LOCATION quand absents', () => {
    const ics = buildInterviewIcs({
      ...base,
      description: null,
      location: null,
    })!;
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('LOCATION:');
  });

  it('renvoie null si le début est invalide (pas d’événement sans date)', () => {
    expect(buildInterviewIcs({ ...base, startAt: 'pas-une-date' })).toBeNull();
  });
});
