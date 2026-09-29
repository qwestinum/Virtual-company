import { describe, expect, it } from 'vitest';

import { datesKey, parseDatesCsv } from '../dates-csv';

const TODAY = new Date('2026-09-29T12:00:00Z');

describe('fichier de dates de candidature', () => {
  it('lit les deux formats, les deux séparateurs, avec ou sans en-tête', () => {
    const r = parseDatesCsv('fichier;date\nCV Martin.pdf;2025-03-14\nb.docx;01/02/2024\n', TODAY);
    expect(r.errors).toEqual([]);
    expect(r.dates.get('cv martin.pdf')).toBe('2025-03-14');
    expect(r.dates.get('b.docx')).toBe('2024-02-01');

    const c = parseDatesCsv('﻿a.pdf,2023-12-31\r\n', TODAY);
    expect(c.errors).toEqual([]);
    expect(c.dates.get('a.pdf')).toBe('2023-12-31');
  });

  it('correspond sur le NOM de fichier seul, sans casse', () => {
    expect(datesKey('fonds/2024/CV Martin.PDF')).toBe('cv martin.pdf');
    expect(datesKey('archive.zip:dossier\\CV.pdf')).toBe('cv.pdf');
  });

  it('une ligne illisible est une ERREUR, jamais ignorée', () => {
    const r = parseDatesCsv('a.pdf;2025-02-30\nb.pdf;demain\nc.pdf\nd.pdf;2027-01-01\n', TODAY);
    expect(r.errors).toHaveLength(4);
    expect(r.dates.size).toBe(0);
  });

  it('deux dates différentes pour un même fichier : erreur ; la même : tolérée', () => {
    expect(parseDatesCsv('a.pdf;2025-01-01\nA.pdf;2025-01-01\n', TODAY).errors).toEqual([]);
    expect(parseDatesCsv('a.pdf;2025-01-01\na.pdf;2025-01-02\n', TODAY).errors).toHaveLength(1);
  });
});
