import { describe, expect, it } from 'vitest';

import { classifyEntry } from '../classify';

describe('ce qu’un fichier du fonds devient', () => {
  it('PDF et DOCX entrent, quelle que soit la casse', () => {
    expect(classifyEntry('a/CV.PDF', false)).toEqual({ kind: 'cv', extension: '.pdf' });
    expect(classifyEntry('b.docx', true)).toEqual({ kind: 'cv', extension: '.docx' });
  });

  it('tout le reste est LISTÉ avec sa raison', () => {
    expect(classifyEntry('vieux.doc', false)).toMatchObject({ kind: 'ignored', reason: expect.stringContaining('.doc') });
    expect(classifyEntry('photo.jpg', false)).toMatchObject({ kind: 'ignored', reason: expect.stringContaining('.jpg') });
    expect(classifyEntry('LISEZMOI', false)).toMatchObject({ kind: 'ignored' });
    expect(classifyEntry('__MACOSX/._cv.pdf', true)).toMatchObject({ kind: 'ignored', reason: 'fichier système ou caché' });
    expect(classifyEntry('.DS_Store', false)).toMatchObject({ kind: 'ignored' });
  });

  it('une archive s’ouvre dans un dossier, jamais dans une archive', () => {
    expect(classifyEntry('lot.zip', false)).toEqual({ kind: 'zip' });
    expect(classifyEntry('lot.zip', true)).toMatchObject({ kind: 'ignored', reason: expect.stringContaining('--zip') });
  });
});
