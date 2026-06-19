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

  it('intègre le lien signé du CV dans la description et en ATTACH (URI, non échappé)', () => {
    const url = 'https://x.supabase.co/storage/v1/object/sign/cv.pdf?token=abc';
    const ics = buildInterviewIcs({ ...base, cvUrl: url })!;
    // On déplie (les longues lignes sont repliées RFC 5545) avant d'asserter.
    const unfolded = ics.replace(/\r\n /g, '');
    // Lien cliquable côté Google Calendar via la description.
    expect(unfolded).toContain(`CV du candidat : ${url}`);
    // ATTACH URI : la valeur n'est PAS text-escapée (pas de \, sur les paramètres URL).
    expect(unfolded).toContain(`ATTACH;FMTTYPE=application/pdf:${url}`);
  });

  it('ajoute une variante HTML (X-ALT-DESC) text-escapée quand fournie', () => {
    const ics = buildInterviewIcs({
      ...base,
      description: 'Texte brut du briefing.',
      htmlDescription: '<h3>Synthèse</h3><p>Profil solide, sérieux.</p>',
    })!;
    const unfolded = ics.replace(/\r\n /g, '');
    // Le repli texte brut reste présent (Google/Apple).
    expect(unfolded).toContain('DESCRIPTION:Texte brut du briefing.');
    // La variante HTML est émise et text-escapée (la virgule devient \,).
    expect(unfolded).toContain(
      'X-ALT-DESC;FMTTYPE=text/html:<h3>Synthèse</h3><p>Profil solide\\, sérieux.</p>',
    );
  });

  it('omet X-ALT-DESC quand aucune variante HTML n’est fournie', () => {
    const ics = buildInterviewIcs(base)!;
    expect(ics).not.toContain('X-ALT-DESC');
  });

  it('embarque le CV binaire (ATTACH base64) et plie les lignes à ≤ 75 caractères', () => {
    const base64 = 'QUJD'.repeat(60); // 240 caractères → forcément plié
    const ics = buildInterviewIcs({
      ...base,
      cvBinary: { base64, filename: 'cv.pdf', mimeType: 'application/pdf' },
    })!;
    // Aucune ligne physique ne dépasse 75 caractères (pliage RFC 5545).
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Une fois déplié, le base64 complet est présent dans un ATTACH binaire.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('ENCODING=BASE64;VALUE=BINARY');
    expect(unfolded).toContain('X-APPLE-FILENAME=cv.pdf');
    expect(unfolded).toContain(base64);
  });
});
