import { describe, expect, it } from 'vitest';

import { sanitizeFieldExtractions } from '@/lib/agents/extraction-guard';

describe('sanitizeFieldExtractions', () => {
  it('garde les champs valides et les trim', () => {
    expect(
      sanitizeFieldExtractions({
        job_title: '  Comptable  ',
        seniority: 'senior',
      }),
    ).toEqual({ job_title: 'Comptable', seniority: 'senior' });
  });

  it('ignore toute clé hors de la liste fermée', () => {
    expect(
      sanitizeFieldExtractions({
        job_title: 'Comptable',
        // clés hors périmètre — doivent être ignorées
        status: 'active',
        campaign_launched: true,
        salaire: '50K',
      }),
    ).toEqual({ job_title: 'Comptable' });
  });

  it('champs liste : tableau de strings non vides, sinon écarté', () => {
    expect(
      sanitizeFieldExtractions({
        main_missions: ['  Compta  ', '', 42, 'Révision'],
        key_skills: 'pas un tableau',
      }),
    ).toEqual({ main_missions: ['Compta', 'Révision'] });
  });

  it('écarte les scalaires vides et les types invalides', () => {
    expect(
      sanitizeFieldExtractions({
        job_title: '   ',
        seniority: { x: 1 },
        location: 'Paris',
      }),
    ).toEqual({ location: 'Paris' });
  });

  it('tolère un nombre pour un scalaire (converti en string)', () => {
    expect(sanitizeFieldExtractions({ salary_range: 50 })).toEqual({
      salary_range: '50',
    });
  });

  it('total : null / non-objet / tableau → objet vide', () => {
    expect(sanitizeFieldExtractions(null)).toEqual({});
    expect(sanitizeFieldExtractions('nope')).toEqual({});
    expect(sanitizeFieldExtractions(undefined)).toEqual({});
    expect(sanitizeFieldExtractions(['x'])).toEqual({});
  });

  it('un tableau liste entièrement invalide est écarté (pas de clé vide)', () => {
    expect(sanitizeFieldExtractions({ main_missions: ['', '  '] })).toEqual({});
  });
});
