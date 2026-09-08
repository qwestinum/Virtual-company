/**
 * Le validateur de règles métier.
 *
 * Chaque cas d'échec vérifie DEUX choses : que la règle mord, et qu'elle porte
 * le code Apec qu'elle prévient. Le second point est ce qui rend le validateur
 * vérifiable : le jour où l'Apec rejette malgré tout avec un code, on sait
 * immédiatement si notre règle existe et est trop laxiste, ou si elle manque.
 */
import { describe, expect, it } from 'vitest';

import { ADEP_ERROR_CATALOGUE, describeAdepError, extractErrorCode } from '../errors';
import { ADEP_LIMITS, isLuhnValid, validateAdepOffer } from '../validate';
import type { AdepOffer } from '@/types/adep';
import {
  SAMPLE_OFFER,
  SAMPLE_OFFER_BROKER,
  SAMPLE_TODAY,
} from './fixtures/sample-offer';

const check = (patch: Partial<AdepOffer>) =>
  validateAdepOffer({ ...SAMPLE_OFFER, ...patch }, SAMPLE_TODAY);

/** Les codes des erreurs (pas des avertissements) levées. */
const codes = (patch: Partial<AdepOffer>) =>
  check(patch).errors.map((e) => e.preventsCode);

describe('l’offre d’exemple', () => {
  it('est valide — sans quoi tous les autres tests ne prouveraient rien', () => {
    const report = validateAdepOffer(SAMPLE_OFFER, SAMPLE_TODAY);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('est valide aussi en mode client indirect', () => {
    expect(validateAdepOffer(SAMPLE_OFFER_BROKER, SAMPLE_TODAY).ok).toBe(true);
  });
});

describe('identité de la transaction', () => {
  it('refuse une référence de plus de 20 caractères', () => {
    expect(codes({ clientPositionId: 'CAMP-2026-288-REPUBLICATION-3' })).toContain('309');
  });

  it('laisse passer CAMP-YYYY-NNN et ses suffixes de republication', () => {
    expect(check({ clientPositionId: 'CAMP-2026-288' }).ok).toBe(true);
    expect(check({ clientPositionId: 'CAMP-2026-288-12' }).ok).toBe(true);
    expect('CAMP-2026-288-999'.length).toBeLessThanOrEqual(ADEP_LIMITS.clientPositionId);
  });

  it('refuse les caractères interdits d’un identifiant de transaction', () => {
    // Le tiret est autorisé, les deux-points NON — un horodatage ISO comme
    // identifiant serait donc refusé, et c'est un piège facile.
    expect(codes({ trackingId: 'orqa-2026-09-08T10:00:00Z' })).toContain('105');
    expect(check({ trackingId: 'orqa-CAMP-2026-288-1757000000000' }).ok).toBe(true);
  });
});

describe('lieux', () => {
  it('refuse Paris, Lyon et Marseille en commune globale', () => {
    for (const commune of ['75056', '69123', '13055']) {
      expect(codes({ inseeCode: commune })).toContain('356');
    }
  });

  it('dit quoi faire au lieu de dire seulement non', () => {
    const [issue] = check({ inseeCode: '75056' }).errors.filter(
      (e) => e.field === 'inseeCode',
    );
    expect(issue?.message).toContain('arrondissement');
    expect(issue?.message).toContain('75101');
  });

  it('accepte les arrondissements', () => {
    for (const commune of ['75101', '69381', '13201']) {
      expect(check({ inseeCode: commune }).ok).toBe(true);
    }
  });

  it('accepte les codes corses (2A/2B)', () => {
    expect(check({ inseeCode: '2A004' }).ok).toBe(true);
  });

  it('refuse une zone de déplacement hors domaine', () => {
    expect(
      codes({ travelZone: 'EUROPE' as AdepOffer['travelZone'] }),
    ).toContain('355');
  });
});

describe('contrat et durée', () => {
  it('refuse une durée sur un CDI', () => {
    expect(codes({ jobType: '1', durationMonths: 12 })).toContain('397');
  });

  it('refuse une durée sur un CDI ALTERNANCE — la base fait la règle, pas le nom', () => {
    // « CDI - Alternance » (2, 3) reste un CDI ; « CDD - Alternance » (6, 7)
    // reste un CDD. Lire la règle dans le libellé serait l'erreur.
    expect(codes({ jobType: '2', durationMonths: 24 })).toContain('397');
    expect(codes({ jobType: '3', durationMonths: 24 })).toContain('397');
    expect(check({ jobType: '6', durationMonths: 24 }).ok).toBe(true);
  });

  it('refuse un CDI intérimaire avec durée — c’est un CDI', () => {
    expect(codes({ jobType: '4', durationMonths: 6 })).toContain('397');
  });

  it('exige une durée sur un CDD, un intérim, un stage', () => {
    for (const jobType of ['5', '8'] as const) {
      expect(codes({ jobType, durationMonths: null })).toContain('397');
    }
  });

  it('borne la durée à 1–99 mois', () => {
    expect(codes({ jobType: '5', durationMonths: 0 })).toContain('394');
    expect(codes({ jobType: '5', durationMonths: 100 })).toContain('394');
    expect(check({ jobType: '5', durationMonths: 1 }).ok).toBe(true);
  });

  it('exige la modalité quand le poste est à temps partiel', () => {
    expect(codes({ partTime: true, partTimeDuration: null })).toContain('400');
    expect(check({ partTime: true, partTimeDuration: '3' }).ok).toBe(true);
  });

  it('AVERTIT seulement sur une modalité laissée à temps plein', () => {
    // Un avertissement ne bloque pas : le flux n'émettra simplement pas le
    // champ. Bloquer ici empêcherait de publier une offre valide.
    const report = check({ partTime: false, partTimeDuration: '3' });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.field)).toContain('partTimeDuration');
  });

  it('exige un niveau d’étude pour un stage', () => {
    expect(codes({ jobType: '9', durationMonths: 6, educationLevel: null })).toContain(
      '418',
    );
    expect(check({ jobType: '9', durationMonths: 6, educationLevel: '3' }).ok).toBe(true);
  });
});

describe('mode client', () => {
  it('refuse le mode indirect sans bloc client réel', () => {
    expect(codes({ relationship: 'broker', finalClient: null })).toContain('1399');
  });

  it('refuse un bloc client réel en mode direct', () => {
    expect(
      codes({ relationship: 'self', finalClient: SAMPLE_OFFER_BROKER.finalClient }),
    ).toContain('329');
  });

  it('refuse l’intérim en mode indirect', () => {
    const report = validateAdepOffer(
      { ...SAMPLE_OFFER_BROKER, jobType: '8', durationMonths: 3 },
      SAMPLE_TODAY,
    );
    expect(report.errors.map((e) => e.preventsCode)).toContain('1398');
  });

  it('refuse une raison sociale de plus de 38 caractères, et dit pourquoi', () => {
    const report = validateAdepOffer(
      {
        ...SAMPLE_OFFER_BROKER,
        finalClient: {
          ...SAMPLE_OFFER_BROKER.finalClient!,
          organizationName: 'BANQUE COOPÉRATIVE RÉGIONALE DE LOIRE ET TOURAINE',
        },
      },
      SAMPLE_TODAY,
    );
    const issue = report.errors.find((e) => e.field === 'finalClient.organizationName');
    expect(issue?.preventsCode).toBe('375');
    // La confusion 38 vs 255 est le piège : le message doit la lever.
    expect(issue?.message).toContain("pas l'enseigne affichée");
  });

  it('refuse un SIRET qui n’a pas 14 chiffres', () => {
    const report = validateAdepOffer(
      {
        ...SAMPLE_OFFER_BROKER,
        finalClient: { ...SAMPLE_OFFER_BROKER.finalClient!, siret: '552081317' },
      },
      SAMPLE_TODAY,
    );
    expect(report.errors.map((e) => e.preventsCode)).toContain('310');
  });

  it('AVERTIT seulement sur une clé de Luhn fausse', () => {
    // Le SIRET de La Poste ne vérifie pas Luhn. Refuser une entreprise réelle
    // sur une règle arithmétique serait pire que laisser l'Apec trancher.
    const report = validateAdepOffer(
      {
        ...SAMPLE_OFFER_BROKER,
        finalClient: { ...SAMPLE_OFFER_BROKER.finalClient!, siret: '55208131766523' },
      },
      SAMPLE_TODAY,
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.field)).toContain('finalClient.siret');
  });
});

describe('textes', () => {
  it('refuse un descriptif de moins de 200 caractères et dit combien il en fait', () => {
    const report = check({ positionDescription: 'Trop court.' });
    const issue = report.errors.find((e) => e.field === 'positionDescription');
    expect(issue?.preventsCode).toBe('337');
    expect(issue?.message).toContain('200');
    expect(issue?.message).toContain('11');
  });

  it('refuse un descriptif de plus de 3 000 caractères', () => {
    expect(codes({ positionDescription: 'x'.repeat(3001) })).toContain('331');
  });

  it('refuse un profil ou une description d’entreprise sous 100 caractères', () => {
    expect(codes({ profileDescription: 'x'.repeat(99) })).toContain('408');
    expect(codes({ organizationDescription: 'x'.repeat(99) })).toContain('407');
  });

  it('exige l’enseigne affichée, jusqu’à 255 caractères', () => {
    expect(codes({ organizationName: '' })).toContain('406');
    expect(codes({ organizationName: 'x'.repeat(256) })).toContain('406');
    expect(check({ organizationName: 'x'.repeat(255) }).ok).toBe(true);
  });

  it('borne les textes facultatifs à 500 caractères', () => {
    expect(codes({ presentationDescription: 'x'.repeat(501) })).toContain('409');
    expect(codes({ recruitmentDescription: 'x'.repeat(501) })).toContain('410');
  });

  it('refuse une vidéo hors YouTube, Vimeo, Dailymotion', () => {
    expect(codes({ videoUrl: 'https://exemple.fr/video.mp4' })).toContain('411');
    expect(check({ videoUrl: 'https://youtu.be/abc123' }).ok).toBe(true);
  });
});

describe('intitulé', () => {
  it('compte la mention H/F dans la limite de 80', () => {
    // 76 caractères sans la mention, 80 avec : la limite est celle du texte
    // RÉELLEMENT envoyé, pas celle de la saisie.
    const title = 'x'.repeat(77);
    const report = check({ positionTitle: title });
    expect(report.errors.map((e) => e.preventsCode)).toContain('316');
    expect(check({ positionTitle: 'x'.repeat(76) }).ok).toBe(true);
  });

  it('ne pénalise pas un intitulé qui porte déjà la mention', () => {
    expect(check({ positionTitle: `${'x'.repeat(76)} F/H` }).ok).toBe(true);
  });
});

describe('candidatures', () => {
  it('exige une adresse de réception, avec un message actionnable', () => {
    const issue = check({ applicationEmail: '' }).errors.find(
      (e) => e.field === 'applicationEmail',
    );
    expect(issue?.preventsCode).toBe('378');
    expect(issue?.message).toContain('boîte mail');
  });

  it('refuse une adresse mal formée ou trop longue', () => {
    expect(codes({ applicationEmail: 'pas-une-adresse' })).toContain('308');
    expect(
      codes({ applicationEmail: `${'x'.repeat(240)}@exemple.fr` }),
    ).toContain('379');
  });

  it('AVERTIT sur une URL de candidature en offre confidentielle', () => {
    // Le constructeur ne l'émettra pas ; le dire évite au recruteur de croire
    // que son URL est partie.
    const report = check({ positionType: 'ODC', applicationUrl: 'https://exemple.fr/o' });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.preventsCode)).toContain('1336');
  });

  it('exige un contact de suivi complet ou entièrement vide', () => {
    expect(
      codes({
        applyContact: {
          civility: '2',
          givenName: 'Sami',
          familyName: '',
          qualification: 'Consultant',
        },
      }),
    ).toContain('404');
  });
});

describe('dates', () => {
  it('refuse une prise de poste dans le passé', () => {
    expect(codes({ datePositionTaken: '2026-09-07' })).toContain('402');
  });

  it('accepte une prise de poste aujourd’hui', () => {
    expect(check({ datePositionTaken: SAMPLE_TODAY, releaseDate: null }).ok).toBe(true);
  });

  it('borne la parution à J+60', () => {
    expect(codes({ releaseDate: '2026-11-30', datePositionTaken: null })).toContain('403');
    expect(check({ releaseDate: '2026-11-07', datePositionTaken: null }).ok).toBe(true);
  });

  it('exige que la parution précède la prise de poste', () => {
    expect(
      codes({ releaseDate: '2026-11-02', datePositionTaken: '2026-11-02' }),
    ).toContain('403');
  });

  it('n’a besoin d’aucune horloge — la date est injectée', () => {
    // Une règle de date qui lit l'heure système ne se teste pas, et se met à
    // échouer un matin.
    const future = validateAdepOffer(SAMPLE_OFFER, '2027-01-01');
    expect(future.errors.map((e) => e.field)).toContain('datePositionTaken');
  });
});

describe('rémunération et postes', () => {
  it('exige les deux bornes de salaire pour une offre d’emploi', () => {
    expect(codes({ salaryMin: null })).toContain('317');
    expect(codes({ salaryMax: null })).toContain('318');
  });

  it('ne les exige pas pour un stage', () => {
    const report = check({
      jobType: '9',
      durationMonths: 6,
      educationLevel: '3',
      salaryMin: null,
      salaryMax: null,
      displayedPay: '5',
    });
    expect(report.ok).toBe(true);
  });

  it('refuse un maximum inférieur au minimum', () => {
    expect(codes({ salaryMin: 60000, salaryMax: 40000 })).toContain('318');
  });

  it('borne le nombre de postes à 1–10', () => {
    expect(codes({ numberToFill: 0 })).toContain('321');
    expect(codes({ numberToFill: 11 })).toContain('321');
  });
});

describe('lien règle ↔ catalogue', () => {
  it('chaque code prévenu existe au catalogue', () => {
    // Sans ce lien, une règle pourrait prévenir un code imaginaire, et la
    // traduction d'un rejet réel n'aurait aucun message à offrir.
    const patches: Array<Partial<AdepOffer>> = [
      { clientPositionId: 'x'.repeat(30) },
      { trackingId: 'a:b' },
      { inseeCode: '75056' },
      { travelZone: 'X' as AdepOffer['travelZone'] },
      { jobType: '1', durationMonths: 3 },
      { jobType: '5', durationMonths: 0 },
      { partTime: true, partTimeDuration: null },
      { jobType: '9', durationMonths: 6, educationLevel: null },
      { positionDescription: 'court' },
      { profileDescription: 'court' },
      { organizationDescription: 'court' },
      { organizationName: '' },
      { presentationDescription: 'x'.repeat(501) },
      { recruitmentDescription: 'x'.repeat(501) },
      { videoUrl: 'https://exemple.fr/v' },
      { positionTitle: 'x'.repeat(90) },
      { applicationEmail: '' },
      { applicationEmail: 'nope' },
      { numberToFill: 0 },
      { salaryMin: null },
      { salaryMax: null },
      { datePositionTaken: '2020-01-01' },
      { releaseDate: '2027-01-01', datePositionTaken: null },
      { nafCode: 'ABC' },
      { relationship: 'broker', finalClient: null },
      { relationship: 'self', finalClient: SAMPLE_OFFER_BROKER.finalClient },
    ];
    const seen = new Set<string>();
    for (const patch of patches) {
      for (const issue of check(patch).errors) {
        seen.add(issue.preventsCode);
        expect(
          ADEP_ERROR_CATALOGUE[issue.preventsCode],
          `code ${issue.preventsCode} absent du catalogue (règle sur ${issue.field})`,
        ).toBeDefined();
      }
    }
    // Le corpus doit réellement couvrir du terrain, sinon la garde ne prouve rien.
    expect(seen.size).toBeGreaterThan(15);
  });

  it('chaque champ nommé par le catalogue est un champ réel', () => {
    // Le catalogue couvre TOUTES les opérations ADEP, pas seulement la
    // création : `apecPositionNumero` est le champ d'entrée de
    // `getPositionStatus` et `updatePositionStatus`, il n'appartient donc pas
    // à l'offre. On l'admet NOMMÉMENT plutôt que d'assouplir la garde — une
    // liste explicite fait qu'une faute de frappe reste détectée.
    const OPERATION_FIELDS = new Set(['apecPositionNumero']);
    const offerKeys = new Set(Object.keys(SAMPLE_OFFER));
    for (const [code, entry] of Object.entries(ADEP_ERROR_CATALOGUE)) {
      if (!entry.field) continue;
      const root = entry.field.split('.')[0]!;
      expect(
        offerKeys.has(root) || OPERATION_FIELDS.has(root),
        `${code} vise un champ inconnu : ${entry.field}`,
      ).toBe(true);
    }
  });
});

describe('traduction des erreurs Apec', () => {
  it('lit le code de l’identifiant, ou à défaut du nom', () => {
    expect(extractErrorCode({ code: '330', message: 'peu importe' })).toBe('330');
    expect(
      extractErrorCode({ code: null, message: 'API_390_MORE_THAN_ONE_REF_FOUND_ERROR' }),
    ).toBe('390');
    expect(extractErrorCode({ code: null, message: 'bruit' })).toBeNull();
  });

  it('distingue les trois natures — la phrase n’est pas la même', () => {
    expect(describeAdepError({ code: '316' }).nature).toBe('field');
    expect(describeAdepError({ code: '330' }).nature).toBe('account');
    expect(describeAdepError({ code: '002' }).nature).toBe('apec');
  });

  it('n’escamote jamais un code inconnu', () => {
    // Un message vide devant un rejet est pire qu'un message technique.
    const described = describeAdepError({ code: '9999', message: 'API_9999_MYSTERE' });
    expect(described.message).toContain('9999');
    expect(described.message).toContain('support ADEP');
  });

  it('donne au 361 le vrai sens de la fenêtre de 30 jours', () => {
    // Ce n'est pas une péremption d'annonce : c'est la republication qui
    // devient impossible.
    expect(describeAdepError({ code: '361' }).message).toContain('republication');
    expect(describeAdepError({ code: '361' }).message).toContain('nouvelle offre');
  });
});

describe('clé de Luhn', () => {
  it('valide un SIRET correct et rejette un chiffre modifié', () => {
    expect(isLuhnValid('55208131766522')).toBe(true);
    expect(isLuhnValid('55208131766523')).toBe(false);
  });
});
