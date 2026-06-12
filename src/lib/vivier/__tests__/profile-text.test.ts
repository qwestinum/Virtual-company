import { describe, expect, it } from 'vitest';

import {
  buildVivierProfileText,
  PROFILE_CV_HEAD_CHARS,
} from '@/lib/vivier/profile-text';
import { EMPTY_VIVIER_ENTITIES, type VivierEntities } from '@/types/vivier';

function ent(over: Partial<VivierEntities> = {}): VivierEntities {
  return { ...EMPTY_VIVIER_ENTITIES, ...over };
}

describe('buildVivierProfileText', () => {
  it('combine la tête du CV et le relevé d’entités', () => {
    const text = buildVivierProfileText(
      ent({
        technologies: ['Java', 'Spring'],
        certifications: ['ISTQB'],
        experienceYears: 7,
        localisation: 'Paris',
      }),
      'Jean Dupont — Test Manager\nRésumé du profil…',
    );
    expect(text).toContain('Jean Dupont — Test Manager');
    expect(text).toContain('Technologies : Java, Spring');
    expect(text).toContain('Certifications : ISTQB');
    expect(text).toContain('Expérience : 7 ans');
    expect(text).toContain('Localisation : Paris');
  });

  it('n’embedde PAS le CV entier : le corps au-delà de la tête est exclu', () => {
    const cv =
      'TÊTE DU CV ' + 'y'.repeat(PROFILE_CV_HEAD_CHARS) + ' QUEUE_UNIQUE';
    const text = buildVivierProfileText(ent({ technologies: ['Java'] }), cv);
    expect(text).not.toContain('QUEUE_UNIQUE');
    expect(text).toContain('TÊTE DU CV');
    expect(text).toContain('Technologies : Java');
  });

  it('entités vides ⇒ se rabat sur la tête du CV', () => {
    expect(buildVivierProfileText(ent(), 'Contenu du CV')).toBe('Contenu du CV');
  });
});
