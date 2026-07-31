import { describe, expect, it } from 'vitest';

import {
  cvAttachmentPriority,
  fileExtension,
  isSupportedCvAttachment,
  isUnsupportedCvAttachment,
  orderCvAttachmentsByPriority,
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

describe('cvAttachmentPriority — vraisemblance « vrai CV » par nom de fichier', () => {
  it('reconnaît les noms de CV réels (corpus prod)', () => {
    for (const name of [
      'Cv_Malaka.pdf',
      'CV_fr.pdf',
      'CV_juin.pdf',
      'BA_CV_Mariem_Benkacem.pdf',
      'CV-Kevin_NGUYEN.pdf',
      'cv_maram_gabsii_f_Data_Engineeer_2_.pdf',
      'Curriculum_Vitae_Kossivi_LOGLO.pdf',
      'resume-john-doe.pdf',
      'Résumé de carrière.pdf',
    ]) {
      expect(cvAttachmentPriority(name), name).toBeGreaterThan(0);
    }
  });

  it('pénalise les documents annexes (lettre APEC, export profil)', () => {
    for (const name of [
      'candidature.pdf',
      'lettre_de_motivation.pdf',
      'Lettre-Motivation-Jean.pdf',
      'alexandr.rihard_gmail.com_PROFIL.pdf',
      'cover_letter.pdf',
    ]) {
      expect(cvAttachmentPriority(name), name).toBeLessThan(0);
    }
  });

  it('reste neutre sur un nom quelconque — jamais une exclusion', () => {
    expect(cvAttachmentPriority('dkaneFr.docx')).toBe(0);
    // « dossier de compétences » = vrai CV : PAS pénalisé.
    expect(
      cvAttachmentPriority('Dossier_competences_Pierre_DORIVAL_Data_analyst_BI.pdf'),
    ).toBe(0);
    expect(cvAttachmentPriority(null)).toBe(0);
  });

  it('ne matche pas « cv » enfoui dans un mot', () => {
    expect(cvAttachmentPriority('encvlopedie.pdf')).toBe(0);
  });
});

describe('orderCvAttachmentsByPriority — le vrai CV d’abord, tri stable', () => {
  it('mail APEC : CV > neutre > lettre/profil', () => {
    const atts = [
      { filename: 'candidature.pdf' },
      { filename: 'notes.pdf' },
      { filename: 'Cv_Malaka.pdf' },
      { filename: 'aime_gmail.com_PROFIL.pdf' },
    ];
    expect(
      orderCvAttachmentsByPriority(atts, (a) => a.filename).map((a) => a.filename),
    ).toEqual([
      'Cv_Malaka.pdf',
      'notes.pdf',
      'candidature.pdf',
      'aime_gmail.com_PROFIL.pdf',
    ]);
  });

  it('à score égal, conserve l’ordre du mail (déterminisme des re-fetch)', () => {
    const atts = [{ filename: 'b.pdf' }, { filename: 'a.pdf' }];
    expect(
      orderCvAttachmentsByPriority(atts, (a) => a.filename).map((a) => a.filename),
    ).toEqual(['b.pdf', 'a.pdf']);
  });
});
