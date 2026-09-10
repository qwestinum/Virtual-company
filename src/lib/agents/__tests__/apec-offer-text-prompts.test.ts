import { describe, expect, it } from 'vitest';

import {
  APEC_TEXT_TARGET_WORDS,
  apecTextBounds,
  buildApecOfferTextSystemPrompt,
  buildApecOfferTextUserPrompt,
  normalizeApecText,
} from '@/lib/agents/apec-offer-text-prompts';
import {
  ApecOfferTextSchema,
  apecOfferTextSchema,
} from '@/lib/agents/server/apec-offer-text-write';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';

/** Un texte de n caractères, en mots — pour éprouver les bornes. */
function chars(n: number): string {
  return 'mot '.repeat(Math.ceil(n / 4)).slice(0, n);
}

describe('normalizeApecText — un champ APEC est du texte brut', () => {
  it('déplie une liste à tirets en prose', () => {
    expect(normalizeApecText('- Vous pilotez le budget\n- Vous animez l’équipe')).toBe(
      'Vous pilotez le budget\nVous animez l’équipe',
    );
  });

  it('retire les marques Markdown que l’Apec afficherait telles quelles', () => {
    expect(normalizeApecText('## Le poste\n**Vous** pilotez le *budget*.')).toBe(
      'Le poste\nVous pilotez le budget.',
    );
  });

  it('GARDE les paragraphes — 150 mots d’un bloc se lisent mal', () => {
    expect(normalizeApecText('Premier paragraphe.\n\nSecond paragraphe.')).toBe(
      'Premier paragraphe.\n\nSecond paragraphe.',
    );
  });

  it('réduit les espaces et les lignes vides en excès', () => {
    expect(normalizeApecText('  Un   texte \n\n\n\n suivi.  ')).toBe(
      'Un texte\n\nsuivi.',
    );
  });

  it('ne tronque JAMAIS un texte long (la longueur est tenue par le schéma)', () => {
    expect(normalizeApecText('a'.repeat(4_000))).toHaveLength(4_000);
  });
});

describe('longueur — la contrainte DURE est celle de l’Apec', () => {
  it('le schéma porte les bornes du canal, pas des bornes maison', () => {
    const tooShortDescription = {
      descriptif: chars(ADEP_LIMITS.positionDescriptionMin - 1),
      profil: chars(600),
    };
    expect(ApecOfferTextSchema.safeParse(tooShortDescription).success).toBe(false);

    const tooShortProfile = {
      descriptif: chars(900),
      profil: chars(ADEP_LIMITS.profileDescriptionMin - 1),
    };
    expect(ApecOfferTextSchema.safeParse(tooShortProfile).success).toBe(false);

    const tooLong = {
      descriptif: chars(ADEP_LIMITS.positionDescriptionMax + 1),
      profil: chars(600),
    };
    expect(ApecOfferTextSchema.safeParse(tooLong).success).toBe(false);
  });

  it('deux textes d’environ 150 mots passent (≈ 900-1100 caractères)', () => {
    expect(
      ApecOfferTextSchema.safeParse({ descriptif: chars(1_000), profil: chars(950) })
        .success,
    ).toBe(true);
  });

  it('la cible est annoncée en MOTS, et les bornes du canal en caractères', () => {
    const prompt = buildApecOfferTextSystemPrompt(apecTextBounds(ADEP_LIMITS));
    expect(prompt).toContain(`${APEC_TEXT_TARGET_WORDS} mots`);
    expect(prompt).toContain(String(ADEP_LIMITS.positionDescriptionMin));
    expect(prompt).toContain(String(ADEP_LIMITS.positionDescriptionMax));
    expect(prompt).toContain(String(ADEP_LIMITS.profileDescriptionMin));
    // Le cadrage demande les DEUX textes, et interdit l'invention.
    expect(prompt).toContain('descriptif');
    expect(prompt).toContain('profil');
    expect(prompt).toMatch(/n'INVENTES rien/);
  });
});

describe('buildApecOfferTextUserPrompt — le matériau est le descriptif affiché', () => {
  const base = {
    jobTitle: 'Comptable général',
    sourceText: 'Tenue de la comptabilité générale d’une PME industrielle.',
    seniority: 'confirmé',
    keySkills: ['Sage', 'fiscalité'],
    contractType: 'CDI',
  };

  it('reprend le matériau tel quel, entre délimiteurs', () => {
    const prompt = buildApecOfferTextUserPrompt(base);
    expect(prompt).toContain('Matériau à mettre en forme');
    expect(prompt).toContain(base.sourceText);
  });

  it('reprend les éléments de la fiche, sans en inventer', () => {
    const prompt = buildApecOfferTextUserPrompt(base);
    expect(prompt).toContain('Comptable général');
    expect(prompt).toContain('confirmé');
    expect(prompt).toContain('Sage, fiscalité');
    expect(prompt).toContain('CDI');
  });

  it('omet les lignes vides plutôt que d’annoncer un champ vide', () => {
    const prompt = buildApecOfferTextUserPrompt({
      ...base,
      seniority: '   ',
      keySkills: ['', '  '],
      contractType: '',
      sourceText: '',
    });
    expect(prompt).not.toContain('Séniorité');
    expect(prompt).not.toContain('Compétences clés');
    expect(prompt).not.toContain('Contrat');
    expect(prompt).not.toContain('Matériau');
    expect(prompt).toContain('Comptable général');
  });
});


describe('apecTextBounds — la place de la mention RGPD est RÉSERVÉE', () => {
  it('sans mention, ce sont exactement les bornes de l’Apec', () => {
    expect(apecTextBounds(ADEP_LIMITS)).toEqual({
      descriptionMin: ADEP_LIMITS.positionDescriptionMin,
      descriptionMax: ADEP_LIMITS.positionDescriptionMax,
      profileMin: ADEP_LIMITS.profileDescriptionMin,
      profileMax: ADEP_LIMITS.profileDescriptionMax,
    });
  });

  it('le plafond du descriptif recule d’autant que la mention occupe', () => {
    // Sinon un texte accepté par le schéma dépasserait la borne de l'Apec une
    // fois la mention apposée — sur un texte que personne n'a écrit trop long.
    const bounds = apecTextBounds(ADEP_LIMITS, 220);
    expect(bounds.descriptionMax).toBe(ADEP_LIMITS.positionDescriptionMax - 220);
    // Le profil ne porte pas la mention : sa borne ne bouge pas.
    expect(bounds.profileMax).toBe(ADEP_LIMITS.profileDescriptionMax);
  });

  it('ne descend jamais sous le plancher, même avec une réserve absurde', () => {
    const bounds = apecTextBounds(ADEP_LIMITS, 99_999);
    expect(bounds.descriptionMax).toBe(ADEP_LIMITS.positionDescriptionMin);
  });

  it('le schéma suit les bornes réduites — le modèle est jugé sur ce qu’on lui a dit', () => {
    const bounds = apecTextBounds(ADEP_LIMITS, 2_000);
    const schema = apecOfferTextSchema(bounds);
    const near = 'mot '.repeat(300).slice(0, 1_100);
    expect(schema.safeParse({ descriptif: near, profil: near }).success).toBe(false);
    expect(ApecOfferTextSchema.safeParse({ descriptif: near, profil: near }).success).toBe(
      true,
    );
  });
});
