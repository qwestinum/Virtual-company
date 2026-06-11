import { describe, expect, it } from 'vitest';

import {
  buildUploadQueue,
  fileExtension,
  flagBatchDuplicatesByEmail,
  isSupportedUploadType,
  unsupportedFormatMessage,
} from '@/lib/vivier/upload-batch';

describe('fileExtension / isSupportedUploadType', () => {
  it('extrait l’extension en minuscules', () => {
    expect(fileExtension('CV.PDF')).toBe('pdf');
    expect(fileExtension('a.b.txt')).toBe('txt');
    expect(fileExtension('sansext')).toBe('');
  });

  it('accepte pdf/txt/md uniquement', () => {
    expect(isSupportedUploadType('cv.pdf')).toBe(true);
    expect(isSupportedUploadType('cv.txt')).toBe(true);
    expect(isSupportedUploadType('cv.md')).toBe(true);
    expect(isSupportedUploadType('cv.docx')).toBe(false);
    expect(isSupportedUploadType('cv.png')).toBe(false);
  });
});

describe('unsupportedFormatMessage', () => {
  it('message DOCX explicite', () => {
    expect(unsupportedFormatMessage('cv.docx')).toBe(
      'Format DOCX non pris en charge pour le moment, convertissez en PDF.',
    );
    expect(unsupportedFormatMessage('cv.doc')).toContain('DOCX');
  });

  it('message générique pour les autres formats', () => {
    expect(unsupportedFormatMessage('cv.png')).toContain('PNG');
    expect(unsupportedFormatMessage('cv.png')).toContain('PDF, TXT, MD');
  });
});

describe('buildUploadQueue', () => {
  it('marque les formats non supportés avec motif, clés stables', () => {
    const q = buildUploadQueue([
      { name: 'a.pdf' },
      { name: 'b.docx' },
      { name: 'c.md' },
    ]);
    expect(q.map((i) => i.supported)).toEqual([true, false, true]);
    expect(q[1]!.reason).toContain('DOCX');
    expect(q[0]!.reason).toBeNull();
    expect(q[0]!.key).toBe('0:a.pdf');
    expect(q[2]!.key).toBe('2:c.md');
  });
});

describe('flagBatchDuplicatesByEmail', () => {
  it('le premier email n’est pas doublon, les suivants oui', () => {
    const flags = flagBatchDuplicatesByEmail([
      { email: 'jane@doe.com' },
      { email: 'JANE@doe.com' }, // même email, casse différente
      { email: 'bob@x.com' },
    ]);
    expect(flags).toEqual([false, true, false]);
  });

  it('les items sans email ne sont jamais doublons', () => {
    const flags = flagBatchDuplicatesByEmail([
      { email: null },
      { email: null },
      { email: 'a@b.com' },
      { email: 'a@b.com' },
    ]);
    expect(flags).toEqual([false, false, false, true]);
  });
});
