import { describe, expect, it } from 'vitest';

import {
  APEC_PROFILE_MAX_CHARS,
  APEC_PROFILE_MIN_CHARS,
  APEC_PROFILE_TARGET_CHARS,
  buildApecProfileSystemPrompt,
  buildApecProfileUserPrompt,
  normalizeApecProfile,
} from '@/lib/agents/apec-profile-prompts';
import { ApecProfileSchema } from '@/lib/agents/server/apec-profile-write';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';

describe('normalizeApecProfile — un champ APEC est du texte brut', () => {
  it('déplie une liste à tirets en texte suivi', () => {
    expect(
      normalizeApecProfile('- Vous maîtrisez Sage\n- Vous aimez les chiffres'),
    ).toBe('Vous maîtrisez Sage Vous aimez les chiffres');
  });

  it('retire les marques Markdown que l’Apec afficherait telles quelles', () => {
    expect(normalizeApecProfile('## Profil\n**Vous** justifiez de *rigueur*.')).toBe(
      'Profil Vous justifiez de rigueur.',
    );
  });

  it('réduit les blancs et coupe les bords', () => {
    expect(normalizeApecProfile('  Vous   justifiez\n\nde rigueur.  ')).toBe(
      'Vous justifiez de rigueur.',
    );
  });

  it('ne tronque JAMAIS un texte long (la longueur est tenue par le schéma)', () => {
    const long = 'a'.repeat(1_000);
    expect(normalizeApecProfile(long)).toHaveLength(1_000);
  });
});

describe('bornes de longueur — le prompt annonce ce que le schéma exige', () => {
  it('les trois nombres du cadrage sont ceux du schéma', () => {
    const prompt = buildApecProfileSystemPrompt();
    expect(prompt).toContain(String(APEC_PROFILE_TARGET_CHARS));
    expect(prompt).toContain(String(APEC_PROFILE_MIN_CHARS));
    expect(prompt).toContain(String(APEC_PROFILE_MAX_CHARS));
  });

  it('le plancher tient l’exigence APEC des 100 caractères, marge comprise', () => {
    // Un profil accepté par le schéma ne doit JAMAIS déclencher API_408.
    expect(APEC_PROFILE_MIN_CHARS).toBeGreaterThan(
      ADEP_LIMITS.profileDescriptionMin,
    );
    expect(APEC_PROFILE_MAX_CHARS).toBeLessThanOrEqual(
      ADEP_LIMITS.profileDescriptionMax,
    );
  });

  it('le schéma refuse un profil trop court — il sera re-demandé au modèle', () => {
    expect(ApecProfileSchema.safeParse({ profil: 'Trop court.' }).success).toBe(
      false,
    );
    expect(
      ApecProfileSchema.safeParse({ profil: 'x'.repeat(APEC_PROFILE_TARGET_CHARS) })
        .success,
    ).toBe(true);
  });

  it('le schéma refuse un profil trop long — jamais de troncature ici', () => {
    expect(
      ApecProfileSchema.safeParse({
        profil: 'x'.repeat(APEC_PROFILE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });
});

describe('buildApecProfileUserPrompt — le descriptif du poste est la source', () => {
  const base = {
    jobTitle: 'Comptable général',
    positionDescription: 'Vous tenez la comptabilité générale d’une PME industrielle.',
    seniority: 'confirmé',
    keySkills: ['Sage', 'fiscalité'],
    contractType: 'CDI',
  };

  it('reprend le descriptif tel quel, entre délimiteurs', () => {
    const prompt = buildApecProfileUserPrompt(base);
    expect(prompt).toContain('Descriptif du poste');
    expect(prompt).toContain(base.positionDescription);
  });

  it('reprend les éléments de la fiche, sans en inventer', () => {
    const prompt = buildApecProfileUserPrompt(base);
    expect(prompt).toContain('Comptable général');
    expect(prompt).toContain('confirmé');
    expect(prompt).toContain('Sage, fiscalité');
    expect(prompt).toContain('CDI');
  });

  it('omet les lignes vides plutôt que d’annoncer un champ vide', () => {
    const prompt = buildApecProfileUserPrompt({
      ...base,
      seniority: '   ',
      keySkills: ['', '  '],
      contractType: '',
      positionDescription: '',
    });
    expect(prompt).not.toContain('Séniorité');
    expect(prompt).not.toContain('Compétences clés');
    expect(prompt).not.toContain('Contrat');
    expect(prompt).not.toContain('Descriptif du poste');
    expect(prompt).toContain('Comptable général');
  });
});
