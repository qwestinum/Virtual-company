/**
 * Campagne → brouillon d'offre.
 *
 * Le fil rouge : le module PROPOSE et ne devine jamais en silence. Chaque test
 * d'une traduction approximative vérifie deux choses — la valeur, et le fait
 * qu'elle est marquée `derived` avec sa provenance. Une conversion qui se
 * présenterait comme un fait est exactement ce qu'on veut empêcher.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAdepDraft,
  completeDraft,
  mapContractType,
  mapSalaryRange,
  mapSeniority,
  type AdepDraftInput,
} from '../mapping';
import {
  buildClientReference,
  isClientReferenceValid,
  nextAttempt,
} from '../reference';
import { validateAdepOffer } from '../validate';
import { DEFAULT_ADEP_CONFIG } from '@/types/adep-settings';
import { buildEmptyFDP, type FDPInProgress, type FieldKey } from '@/types/field-collection';
import {
  SAMPLE_ORGANIZATION_DESCRIPTION,
  SAMPLE_POSITION_DESCRIPTION,
  SAMPLE_PROFILE_DESCRIPTION,
  SAMPLE_TODAY,
} from './fixtures/sample-offer';

function fdpWith(values: Partial<Record<FieldKey, unknown>>): FDPInProgress {
  const fdp = buildEmptyFDP('CAMP-2026-288');
  for (const [key, value] of Object.entries(values)) {
    const field = fdp.fields[key as FieldKey];
    if (field) {
      field.value = value;
      field.status = 'filled';
    }
  }
  return fdp;
}

const BASE_INPUT: AdepDraftInput = {
  campaignId: 'CAMP-2026-288',
  clientReference: 'CAMP-2026-288',
  fdp: fdpWith({
    job_title: 'Consultant AMOA Trade Finance',
    seniority: 'confirmé',
    contract_type: ['CDI'],
    location: 'Tours',
    salary_range: '45 - 55 k€',
    start_date: '2026-11-02',
  }),
  config: {
    ...DEFAULT_ADEP_CONFIG,
    nafCode: '7022Z',
    organizationDescription: SAMPLE_ORGANIZATION_DESCRIPTION,
  },
  organizationName: 'QWESTINUM',
  positionDescription: SAMPLE_POSITION_DESCRIPTION,
  profileDescription: SAMPLE_PROFILE_DESCRIPTION,
  applicationEmail: 'recrutement@qwestinum.fr',
  siteInseeCode: '37261',
};

describe('type de contrat', () => {
  it('traduit sans perte les quatre correspondances certaines', () => {
    expect(mapContractType(['CDI'])).toEqual({ kind: 'certain', jobType: '1', label: 'CDI' });
    expect(mapContractType(['CDD'])).toMatchObject({ kind: 'certain', jobType: '5' });
    expect(mapContractType(['stage'])).toMatchObject({ kind: 'certain', jobType: '9' });
    expect(mapContractType(['intérim'])).toMatchObject({ kind: 'certain', jobType: '8' });
  });

  it('refuse de trancher entre alternance CDI et alternance CDD', () => {
    // L'Apec distingue la BASE (1/5) et le TYPE (apprentissage /
    // professionnalisation) : quatre codes possibles, et ORQA n'a ni l'un ni
    // l'autre. Choisir au hasard publierait un CDD là où le cabinet voulait
    // un CDI.
    const mapping = mapContractType(['alternance']);
    expect(mapping.kind).toBe('ambiguous');
    if (mapping.kind === 'ambiguous') {
      expect(mapping.reason).toContain('CDI ou en CDD');
    }
    expect(mapContractType(['apprentissage']).kind).toBe('ambiguous');
  });

  it('un champ MULTI-VALEUR est toujours ambigu — l’Apec n’en publie qu’un', () => {
    const mapping = mapContractType(['CDI', 'CDD']);
    expect(mapping.kind).toBe('ambiguous');
    if (mapping.kind === 'ambiguous') expect(mapping.reason).toContain("n'en publie qu'un");
  });

  it('déclare non diffusables les contrats sans équivalent Apec', () => {
    for (const contract of ['freelance', 'portage salarial', 'CDI de chantier']) {
      const mapping = mapContractType([contract]);
      expect(mapping.kind, contract).toBe('unsupported');
    }
  });

  it('tolère la casse, les accents et la valeur legacy en chaîne', () => {
    expect(mapContractType('CDI')).toMatchObject({ kind: 'certain', jobType: '1' });
    expect(mapContractType(['interim'])).toMatchObject({ kind: 'certain', jobType: '8' });
    expect(mapContractType(['Stage'])).toMatchObject({ kind: 'certain', jobType: '9' });
  });

  it('rend unknown sur un champ vide, jamais une valeur par défaut', () => {
    expect(mapContractType(null)).toEqual({ kind: 'unknown' });
    expect(mapContractType([])).toEqual({ kind: 'unknown' });
  });
});

describe('séniorité', () => {
  it('propose la correspondance la plus proche du sens courant', () => {
    expect(mapSeniority('junior')).toBe('2'); // aucune expérience exigée
    expect(mapSeniority('confirmé')).toBe('5'); // minimum 3 ans
    expect(mapSeniority('senior')).toBe('7'); // minimum 5 ans
  });

  it('ne retombe sur AUCUNE valeur quand la séniorité est inconnue', () => {
    // « Tous niveaux acceptés » serait le repli tentant : il ferait arriver des
    // candidatures que le cabinet n'attend pas, sans que personne ne l'ait
    // décidé.
    expect(mapSeniority('expert')).toBeNull();
    expect(mapSeniority(null)).toBeNull();
  });
});

describe('fourchette de salaire', () => {
  it('lit les formes courantes, et multiplie les k€', () => {
    expect(mapSalaryRange('45 - 55 k€')).toMatchObject({ min: 45000, max: 55000 });
    expect(mapSalaryRange('45000 à 55000 € brut annuel')).toMatchObject({
      min: 45000,
      max: 55000,
    });
    expect(mapSalaryRange('de 38k à 42k')).toMatchObject({ min: 38000, max: 42000 });
  });

  it('LE PIÈGE : « 45 - 55 k€ » — le k porte sur les deux bornes', () => {
    // C'est la forme la plus courante en français, et la plus dangereuse : en
    // lisant « 45 » tel quel, il tombe sous le seuil de plausibilité, la
    // fourchette s'écrase sur 55 000 – 55 000, et le salaire minimum publié est
    // faux. Rien ne le signale, puisque le résultat reste un nombre crédible.
    expect(mapSalaryRange('45 - 55 k€')).toMatchObject({ min: 45000, max: 55000 });
    expect(mapSalaryRange('entre 45 et 55 k€ brut')).toMatchObject({
      min: 45000,
      max: 55000,
    });
    expect(mapSalaryRange('de 38k à 42k')).toMatchObject({ min: 38000, max: 42000 });
  });

  it('rend une fourchette PLATE sur un montant unique', () => {
    // L'Apec exige les deux bornes. Inventer un écart de 10 % serait
    // exactement la supposition qu'on s'interdit.
    expect(mapSalaryRange('50 k€')).toMatchObject({ min: 50000, max: 50000 });
  });

  it('abandonne franchement plutôt que de deviner', () => {
    // Un montant deviné est pire qu'un champ vide : il part sans relecture.
    expect(mapSalaryRange('selon profil').kind).toBe('unparseable');
    expect(mapSalaryRange('à négocier').kind).toBe('unparseable');
    expect(mapSalaryRange('').kind).toBe('unparseable');
    expect(mapSalaryRange(null).kind).toBe('unparseable');
  });

  it('ignore les nombres qui ne peuvent pas être un salaire annuel', () => {
    // « 35 heures » ne doit pas devenir un salaire de 35 €.
    expect(mapSalaryRange('35 heures hebdomadaires').kind).toBe('unparseable');
  });

  it('tolère les séparateurs de milliers', () => {
    expect(mapSalaryRange('45 000 à 55 000 €')).toMatchObject({
      min: 45000,
      max: 55000,
    });
  });
});

describe('brouillon', () => {
  it('reprend l’intitulé, le NAF et la boîte mail comme des CERTITUDES', () => {
    const draft = buildAdepDraft(BASE_INPUT);
    expect(draft.offer.positionTitle).toBe('Consultant AMOA Trade Finance');
    expect(draft.notes.positionTitle?.origin).toBe('certain');
    expect(draft.notes.nafCode?.origin).toBe('certain');
    expect(draft.notes.applicationEmail?.origin).toBe('certain');
  });

  it('marque expérience et salaire comme DÉRIVÉS, avec leur provenance', () => {
    // C'est ce que l'écran affiche sous le champ : « ← déduit de confirmé ».
    const draft = buildAdepDraft(BASE_INPUT);
    expect(draft.offer.experienceLevel).toBe('5');
    expect(draft.notes.experienceLevel).toEqual({
      origin: 'derived',
      from: 'séniorité « confirmé »',
    });
    expect(draft.notes.salaryMin?.origin).toBe('derived');
    expect(draft.notes.salaryMin?.from).toContain('45 - 55 k€');
  });

  it('laisse le lieu VIDE quand aucun code INSEE n’est connu, et dit pourquoi', () => {
    const draft = buildAdepDraft({ ...BASE_INPUT, siteInseeCode: null });
    expect(draft.offer.inseeCode).toBeNull();
    expect(draft.notes.inseeCode?.origin).toBe('missing');
    expect(draft.notes.inseeCode?.from).toContain('Tours');
    expect(draft.notes.inseeCode?.from).toContain('code commune');
  });

  it('BLOQUE sur un contrat que l’Apec ne diffuse pas', () => {
    const draft = buildAdepDraft({
      ...BASE_INPUT,
      fdp: fdpWith({ ...BASE_INPUT.fdp.fields, contract_type: ['freelance'] }),
    });
    expect(draft.offer.jobType).toBeNull();
    expect(draft.blockers.join(' ')).toContain('freelance');
  });

  it('BLOQUE sur une campagne sans boîte mail associée', () => {
    const draft = buildAdepDraft({ ...BASE_INPUT, applicationEmail: '' });
    expect(draft.blockers.join(' ')).toContain('candidatures');
  });

  it('laisse le contrat à trancher — sans bloquer — quand il est ambigu', () => {
    // Ambigu n'est pas bloquant : l'humain choisit dans le formulaire.
    const draft = buildAdepDraft({
      ...BASE_INPUT,
      fdp: fdpWith({ contract_type: ['alternance'], job_title: 'Chargé de mission' }),
    });
    expect(draft.offer.jobType).toBeNull();
    expect(draft.blockers).toEqual([]);
    expect(draft.notes.jobType?.from).toContain('alternance');
  });

  it('ne remplit une date de prise de poste que si elle est exploitable', () => {
    const loose = buildAdepDraft({
      ...BASE_INPUT,
      fdp: fdpWith({ job_title: 'X', start_date: 'dès que possible' }),
    });
    expect(loose.offer.datePositionTaken).toBeNull();
  });
});

describe('du brouillon à l’offre', () => {
  it('refuse de compléter tant qu’un champ humain manque', () => {
    const draft = buildAdepDraft({ ...BASE_INPUT, siteInseeCode: null });
    expect(completeDraft(draft.offer, 'trk')).toBeNull();
  });

  it('produit une offre qui passe le validateur métier', () => {
    // Le bout-en-bout du lot 2 : une campagne ORQA complète, un formulaire
    // laissé à ses valeurs proposées, et l'Apec n'aurait rien à redire.
    const draft = buildAdepDraft(BASE_INPUT);
    const offer = completeDraft(draft.offer, 'orqa-CAMP-2026-288-1757000000000');
    expect(offer).not.toBeNull();
    const report = validateAdepOffer(offer!, SAMPLE_TODAY);
    expect(report.errors).toEqual([]);
  });
});

describe('référence client', () => {
  it('la première tentative EST l’identifiant de campagne', () => {
    // Le fil de traçabilité : la même chaîne sur apec.fr, dans l'objet des
    // mails et dans ORQA.
    expect(buildClientReference('CAMP-2026-288', 1)).toBe('CAMP-2026-288');
  });

  it('les suivantes portent leur rang, et tiennent dans les 20 caractères', () => {
    expect(buildClientReference('CAMP-2026-288', 2)).toBe('CAMP-2026-288-2');
    expect(buildClientReference('CAMP-2026-288', 999)).toBe('CAMP-2026-288-999');
    expect(isClientReferenceValid(buildClientReference('CAMP-2026-288', 999))).toBe(true);
  });

  it('signale une référence trop longue AVANT la publication', () => {
    expect(isClientReferenceValid('CAMP-2026-288')).toBe(true);
    expect(isClientReferenceValid('CAMPAGNE-REPRISE-EXTERNE-2026-0001')).toBe(false);
    expect(isClientReferenceValid('')).toBe(false);
  });

  it('compte les tentatives plutôt que de lire le plus grand suffixe', () => {
    // Une référence saisie à la main (reprise d'une offre créée sur apec.fr)
    // n'a pas forcément notre forme : lire un suffixe la manquerait, puis
    // réattribuerait une référence déjà prise.
    expect(nextAttempt([])).toBe(1);
    expect(nextAttempt(['CAMP-2026-288'])).toBe(2);
    expect(nextAttempt(['REF-EXTERNE-77', 'CAMP-2026-288-2'])).toBe(3);
  });
});

describe('textes de l’offre — priorité des sources, jamais de resaisie', () => {
  const FDP_WITH_LISTS = fdpWith({
    job_title: 'Consultant AMOA Trade Finance',
    contract_type: ['CDI'],
    main_missions: ['Cadrage des besoins métier', 'Rédaction des spécifications'],
    key_skills: ['Trade Finance', 'AMOA'],
  });

  it('reprend les missions et les compétences DÉJÀ validées dans la fiche', () => {
    // La description du profil est OBLIGATOIRE chez l'Apec (100 caractères
    // minimum) et ORQA la présentait vide alors que les compétences clés sont
    // saisies à deux écrans de là : c'est la resaisie qu'on supprime.
    const draft = buildAdepDraft({
      ...BASE_INPUT,
      fdp: FDP_WITH_LISTS,
      positionDescription: '',
      profileDescription: '',
    });
    expect(draft.offer.positionDescription).toContain('Cadrage des besoins métier');
    expect(draft.offer.profileDescription).toContain('Trade Finance');
    expect(draft.notes.positionDescription?.from).toContain('missions principales');
    expect(draft.notes.profileDescription?.from).toContain('compétences clés');
  });

  it('un texte RELU prime sur la composition automatique', () => {
    // L'annonce générique a été écrite puis publiée par un humain ; la liste de
    // missions est un report brut. Laisser la seconde écraser le premier ferait
    // reculer la qualité du texte à chaque ouverture du panneau.
    const draft = buildAdepDraft({
      ...BASE_INPUT,
      fdp: FDP_WITH_LISTS,
      prefill: {
        source: 'generic_published',
        positionTitle: 'Consultant AMOA Trade Finance (H/F)',
        positionDescription: 'Texte relu et publié sur le canal générique.',
        at: '2026-08-12T09:30:00.000Z',
        label: 'annonce générique publiée du 12/08/2026',
        hasMarkup: false,
      },
    });
    expect(draft.offer.positionDescription).toBe(
      'Texte relu et publié sur le canal générique.',
    );
    expect(draft.notes.positionDescription?.origin).toBe('certain');
    // Le profil, lui, n'a PAS d'équivalent dans l'annonce : il vient toujours
    // des compétences clés.
    expect(draft.offer.profileDescription).toContain('Compétences recherchées');
  });

  it('sans annonce ni listes, les champs restent vides et le DISENT', () => {
    const draft = buildAdepDraft({
      ...BASE_INPUT,
      positionDescription: '',
      profileDescription: '',
    });
    expect(draft.offer.positionDescription).toBe('');
    expect(draft.offer.profileDescription).toBe('');
    expect(draft.notes.positionDescription?.origin).toBe('missing');
    expect(draft.notes.profileDescription?.origin).toBe('missing');
  });
});
