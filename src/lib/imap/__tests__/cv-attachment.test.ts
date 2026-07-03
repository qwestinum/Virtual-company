import { describe, expect, it } from 'vitest';

import {
  fileExtension,
  isSupportedCvAttachment,
  isUnsupportedCvAttachment,
} from '@/lib/imap/cv-attachment';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('fileExtension', () => {
  it('extrait en minuscules, sans point', () => {
    expect(fileExtension('CV.DocX')).toBe('docx');
    expect(fileExtension('mon cv.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('vide sur absence / nom sans extension', () => {
    expect(fileExtension(null)).toBe('');
    expect(fileExtension(undefined)).toBe('');
    expect(fileExtension('cv')).toBe('');
  });
});

describe('isSupportedCvAttachment — PDF + DOCX', () => {
  it('PDF par MIME et par extension', () => {
    expect(isSupportedCvAttachment('application/pdf', 'cv.pdf')).toBe(true);
    expect(isSupportedCvAttachment('application/x-pdf', 'cv.pdf')).toBe(true);
    expect(isSupportedCvAttachment(null, 'cv.pdf')).toBe(true);
  });

  it('DOCX par MIME', () => {
    expect(isSupportedCvAttachment(DOCX_MIME, 'cv.docx')).toBe(true);
  });

  it('DOCX envoyé en octet-stream : accepté par l’extension', () => {
    expect(
      isSupportedCvAttachment('application/octet-stream', 'candidature.docx'),
    ).toBe(true);
  });

  it('DOCX sans contentType : accepté par l’extension', () => {
    expect(isSupportedCvAttachment(null, 'cv.docx')).toBe(true);
  });

  it('rejette .doc, images, et l’inconnu', () => {
    expect(isSupportedCvAttachment('application/msword', 'cv.doc')).toBe(false);
    expect(isSupportedCvAttachment('image/jpeg', 'photo.jpg')).toBe(false);
    expect(isSupportedCvAttachment(null, null)).toBe(false);
  });
});

describe('isUnsupportedCvAttachment — .doc à tracer (jamais silencieux)', () => {
  it('.doc par MIME et par extension', () => {
    expect(isUnsupportedCvAttachment('application/msword', 'cv.doc')).toBe(true);
    expect(isUnsupportedCvAttachment('application/octet-stream', 'cv.doc')).toBe(
      true,
    );
    expect(isUnsupportedCvAttachment(null, 'cv.doc')).toBe(true);
  });

  it('le support PRIME : un PDF/DOCX ne tombe jamais en non-supporté', () => {
    expect(isUnsupportedCvAttachment('application/pdf', 'cv.pdf')).toBe(false);
    expect(isUnsupportedCvAttachment(DOCX_MIME, 'cv.docx')).toBe(false);
  });

  it('ne classe pas les formats hors bureautique (image, inconnu)', () => {
    expect(isUnsupportedCvAttachment('image/png', 'photo.png')).toBe(false);
    expect(isUnsupportedCvAttachment(null, null)).toBe(false);
  });
});
