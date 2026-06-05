import { describe, it, expect } from 'vitest';

import { JobApplicationDataSchema } from '@/types/cv-analysis';

const valid = {
  // Coordonnées
  fullName: 'Camille Durand',
  email: 'camille.durand@example.com',
  phone: '+33 6 12 34 56 78',
  // Métadonnées CV
  detectedLanguage: 'fr',
  fileName: 'cv-camille-durand.pdf',
  source: 'manual',
  receivedAt: '2026-06-05T09:30:00.000Z',
  // Conformité / identifiant
  rightToWork: true,
  location: 'Paris',
  // Photo
  photoPresent: false,
};

describe('JobApplicationDataSchema — données factuelles annexes UNIQUEMENT', () => {
  it('accepte une fiche candidat annexe bien formée', () => {
    expect(JobApplicationDataSchema.safeParse(valid).success).toBe(true);
  });

  it('accepte des coordonnées nulles (email/phone absents du CV)', () => {
    const r = JobApplicationDataSchema.safeParse({
      ...valid,
      email: null,
      phone: null,
      rightToWork: null,
      location: null,
      detectedLanguage: null,
    });
    expect(r.success).toBe(true);
  });

  it('REJETTE toute donnée factuelle servant au scoring (experienceYears)', () => {
    const r = JobApplicationDataSchema.safeParse({ ...valid, experienceYears: 5 });
    expect(r.success).toBe(false);
  });

  it('REJETTE toute donnée d’appréciation (score, strengths, tags libres)', () => {
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, score: 80 }).success,
    ).toBe(false);
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, strengths: ['rigueur'] })
        .success,
    ).toBe(false);
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, tags: ['top profil'] })
        .success,
    ).toBe(false);
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, skills: ['IFRS'] }).success,
    ).toBe(false);
  });

  it('REJETTE un email mal formé', () => {
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, email: 'pas-un-email' })
        .success,
    ).toBe(false);
  });

  it('REJETTE une source hors catalogue', () => {
    expect(
      JobApplicationDataSchema.safeParse({ ...valid, source: 'pigeon_voyageur' })
        .success,
    ).toBe(false);
  });
});
