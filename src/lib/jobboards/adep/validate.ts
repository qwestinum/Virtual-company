/**
 * Validateur local des règles métier ADEP. PUR, sans réseau.
 *
 * ── POURQUOI ICI, ET PAS UN XSD ─────────────────────────────────────────────
 *
 * Un rejet Apec arrive après coup, en anglais de code, devant un client. La
 * quasi-totalité des rejets réels sont des règles de GESTION — « 200 caractères
 * minimum », « Paris interdit », « un CDI n'a pas de durée » — qu'aucun schéma
 * XSD ne connaît. C'est donc ici que se joue la prévention ; le XSD, lui, ne
 * vérifie que la structure, que le constructeur produit de toute façon (et il
 * reste disponible dans `adep:probe`, via xmllint).
 *
 * ── CHAQUE RÈGLE PORTE LE CODE QU'ELLE PRÉVIENT ─────────────────────────────
 *
 * `preventsCode` n'est pas de la décoration. C'est ce qui rend le validateur
 * VÉRIFIABLE : quand l'Apec rejette malgré tout avec le code 331, on sait
 * immédiatement si notre règle 331 existe (elle est trop laxiste) ou non (elle
 * manque). Sans ce lien, on rejouerait le rejet en aveugle.
 *
 * Deux niveaux, et la distinction compte :
 *   · `error`   — l'Apec REFUSERA. Le bouton Publier reste désarmé.
 *   · `warning` — l'offre partira, mais quelque chose mérite un regard.
 * Un avertissement ne bloque jamais : transformer un doute en blocage
 * empêcherait de publier une offre parfaitement valide.
 */

import {
  CIVILITE_CODES,
  FORBIDDEN_INSEE_COMMUNES,
  JOB_TYPES_WITHOUT_DURATION,
  JOB_TYPES_WITH_DURATION,
  NIVEAU_ETUDE_CODES,
  NIVEAU_EXPERIENCE_CODES,
  POSITION_TYPES,
  SALAIRE_TEXTE_CODES,
  STATUT_POSTE_CODES,
  TELETRAVAIL_CODES,
  TEMPS_PARTIEL_DUREE_CODES,
  TYPE_CONTRAT_CODES,
  ZONE_DEPLACEMENT_CODES,
} from './domains';
import { withGenderMention } from './build-open-position';
import type { AdepOffer } from '@/types/adep';

export type AdepIssueLevel = 'error' | 'warning';

export type AdepIssue = {
  level: AdepIssueLevel;
  /** Champ de `AdepOffer` visé — l'écran s'en sert pour ouvrir le bon champ. */
  field: string;
  /** Phrase montrable à un recruteur. */
  message: string;
  /** Code du catalogue Apec que cette règle évite. */
  preventsCode: string;
};

export type AdepValidationReport = {
  ok: boolean;
  errors: AdepIssue[];
  warnings: AdepIssue[];
};

// ── Bornes, toutes issues du catalogue et de la spec ────────────────────────

export const ADEP_LIMITS = {
  clientPositionId: 20,
  trackingId: 100,
  /** Sans la mention H/F. Avec, 80 — cf. API_316. */
  positionTitleWithoutMention: 76,
  positionTitleWithMention: 80,
  positionDescriptionMin: 200,
  positionDescriptionMax: 3000,
  profileDescriptionMin: 100,
  profileDescriptionMax: 3000,
  organizationDescriptionMin: 100,
  organizationDescriptionMax: 3000,
  organizationNameMax: 255,
  finalClientNameMax: 38,
  presentationDescriptionMax: 500,
  recruitmentDescriptionMax: 500,
  applicationEmailMax: 240,
  applicationUrlMax: 2000,
  contactNameMax: 30,
  contactQualificationMax: 80,
  numberToFillMin: 1,
  numberToFillMax: 10,
  durationMin: 1,
  durationMax: 99,
  salaryDigitsMax: 9,
  releaseDateHorizonDays: 60,
} as const;

/** Caractères interdits dans un identifiant de transaction (spec §VI.1). */
const FORBIDDEN_TRACKING_CHARS = new Set(
  `?|,=<>:"[]\\/(){}!;'\`@#$~+*&^`.split(''),
);

/**
 * Caractères de contrôle également interdits. Construit par `RegExp` : des
 * octets invisibles dans le source se perdent au premier copier-coller.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAF_SHAPE = /^\d{4}[A-Za-z]$/;
// Code officiel géographique : 5 caractères. La Corse est la seule
// exception à « cinq chiffres » — 2A004, 2B033 — et l'oublier refuserait
// en local des communes parfaitement valides.
const INSEE_SHAPE = /^(?:\d{2}|2[AB])\d{3}$/i;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const VIDEO_HOSTS = /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|dai\.ly)\//i;

/** Longueur « telle que l'Apec la compte » : le texte visible, balises comprises. */
function len(value: string): number {
  return value.trim().length;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Valide l'offre. `today` est INJECTÉ (`YYYY-MM-DD`) : une règle de date qui
 * lit l'horloge ne se teste pas, et se met à échouer un matin.
 */
export function validateAdepOffer(
  offer: AdepOffer,
  today: string,
): AdepValidationReport {
  const issues: AdepIssue[] = [];
  const err = (field: string, message: string, preventsCode: string) =>
    issues.push({ level: 'error', field, message, preventsCode });
  const warn = (field: string, message: string, preventsCode: string) =>
    issues.push({ level: 'warning', field, message, preventsCode });

  // ── Identité de la transaction ───────────────────────────────────────────
  const reference = offer.clientPositionId.trim();
  if (!reference) {
    err('clientPositionId', "La référence de l'offre est obligatoire.", '309');
  } else if (reference.length > ADEP_LIMITS.clientPositionId) {
    err(
      'clientPositionId',
      `La référence de l'offre dépasse ${ADEP_LIMITS.clientPositionId} caractères (${reference.length}).`,
      '309',
    );
  }

  const tracking = offer.trackingId.trim();
  if (!tracking) {
    err('trackingId', "L'identifiant de transaction est obligatoire.", '105');
  } else {
    if (tracking.length > ADEP_LIMITS.trackingId) {
      err(
        'trackingId',
        `L'identifiant de transaction dépasse ${ADEP_LIMITS.trackingId} caractères.`,
        '105',
      );
    }
    const bad = [...tracking].filter((c) => FORBIDDEN_TRACKING_CHARS.has(c));
    if (bad.length > 0 || CONTROL_CHARS.test(tracking)) {
      err(
        'trackingId',
        `L'identifiant de transaction contient des caractères interdits (${[...new Set(bad)].join(' ')}).`,
        '105',
      );
    }
  }

  // ── Mode client ──────────────────────────────────────────────────────────
  if (offer.relationship === 'broker') {
    const client = offer.finalClient;
    if (!client) {
      err(
        'finalClient',
        'En mode « client indirect », les informations du client réel sont obligatoires.',
        '1399',
      );
    } else {
      if (len(client.organizationName) === 0) {
        err('finalClient.organizationName', 'La raison sociale du client est obligatoire.', '1399');
      } else if (len(client.organizationName) > ADEP_LIMITS.finalClientNameMax) {
        err(
          'finalClient.organizationName',
          `La raison sociale du client dépasse ${ADEP_LIMITS.finalClientNameMax} caractères (${len(client.organizationName)}). Attention : c'est la raison sociale qui sert à retrouver l'entreprise chez l'Apec, pas l'enseigne affichée sur l'annonce.`,
          '375',
        );
      }
      const siret = client.siret.replace(/\s/g, '');
      if (!/^\d{14}$/.test(siret)) {
        err('finalClient.siret', 'Le SIRET du client doit comporter 14 chiffres.', '310');
      } else if (!isLuhnValid(siret)) {
        // AVERTISSEMENT, pas erreur : le SIRET de La Poste ne vérifie pas
        // Luhn, et refuser une entreprise réelle sur une règle arithmétique
        // serait pire que laisser l'Apec trancher.
        warn(
          'finalClient.siret',
          "Ce SIRET ne vérifie pas la clé de contrôle habituelle — à revérifier avant d'envoyer.",
          '310',
        );
      }
      if (!NAF_SHAPE.test(client.nafCode.trim())) {
        err('finalClient.nafCode', 'Le code NAF du client doit être au format 0000X (ex. 7810Z).', '387');
      }
    }
    if (offer.jobType === '8') {
      err(
        'jobType',
        "Le mode « client indirect » est incompatible avec l'intérim.",
        '1398',
      );
    }
  } else if (offer.finalClient) {
    err(
      'finalClient',
      "En mode « client direct », aucune information de client réel ne doit être envoyée.",
      '329',
    );
  }

  if (offer.contactEmail && !EMAIL_SHAPE.test(offer.contactEmail.trim())) {
    err('contactEmail', "L'adresse de l'interlocuteur est mal formée.", '308');
  }

  // ── Le poste ─────────────────────────────────────────────────────────────
  const title = withGenderMention(offer.positionTitle);
  if (len(offer.positionTitle) === 0) {
    err('positionTitle', "L'intitulé du poste est obligatoire.", '316');
  } else if (title.length > ADEP_LIMITS.positionTitleWithMention) {
    err(
      'positionTitle',
      `L'intitulé fait ${title.length} caractères avec la mention H/F (maximum ${ADEP_LIMITS.positionTitleWithMention}).`,
      '316',
    );
  }

  if (!NAF_SHAPE.test(offer.nafCode.trim())) {
    err('nafCode', 'Le code NAF doit être au format 0000X (ex. 7810Z).', '311');
  }

  const insee = offer.inseeCode.trim();
  if (!INSEE_SHAPE.test(insee)) {
    err('inseeCode', 'Le code commune INSEE doit comporter 5 caractères (ex. 37261).', '356');
  } else if (FORBIDDEN_INSEE_COMMUNES[insee]) {
    err('inseeCode', `Commune refusée par l'Apec : ${FORBIDDEN_INSEE_COMMUNES[insee]}.`, '356');
  }

  if (!(ZONE_DEPLACEMENT_CODES as readonly string[]).includes(offer.travelZone)) {
    err('travelZone', "La zone de déplacement n'est pas une valeur acceptée.", '355');
  }

  if (!(NIVEAU_EXPERIENCE_CODES as readonly string[]).includes(offer.experienceLevel)) {
    err('experienceLevel', "Le niveau d'expérience n'est pas une valeur acceptée.", '319');
  }

  if (
    !Number.isInteger(offer.numberToFill) ||
    offer.numberToFill < ADEP_LIMITS.numberToFillMin ||
    offer.numberToFill > ADEP_LIMITS.numberToFillMax
  ) {
    err('numberToFill', 'Le nombre de postes doit être compris entre 1 et 10.', '321');
  }
  // Une seule ville est envoyée par construction : le nombre de lieux vaut
  // toujours 1, et il ne peut donc dépasser le nombre de postes que si
  // celui-ci est à zéro — déjà couvert ci-dessus. La règle 324 est rappelée
  // ici pour mémoire, elle n'a pas de cas d'échec dans notre flux.

  // ── Contrat ──────────────────────────────────────────────────────────────
  if (!(TYPE_CONTRAT_CODES as readonly string[]).includes(offer.jobType)) {
    err('jobType', "Le type de contrat n'est pas une valeur acceptée.", '320');
  }
  if (!(STATUT_POSTE_CODES as readonly string[]).includes(offer.statusJob)) {
    err('statusJob', "Le statut du poste n'est pas une valeur acceptée.", '396');
  }

  if (JOB_TYPES_WITHOUT_DURATION.has(offer.jobType) && offer.durationMonths != null) {
    err('durationMonths', "Un contrat à durée indéterminée ne peut pas porter de durée.", '397');
  }
  if (JOB_TYPES_WITH_DURATION.has(offer.jobType)) {
    if (offer.durationMonths == null) {
      err('durationMonths', 'Ce type de contrat exige une durée en mois.', '397');
    } else if (
      !Number.isInteger(offer.durationMonths) ||
      offer.durationMonths < ADEP_LIMITS.durationMin ||
      offer.durationMonths > ADEP_LIMITS.durationMax
    ) {
      // La spec dit « minimum 0 (= moins d'un mois) », le catalogue dit « entre
      // 1 et 99 ». On applique le plus STRICT en attendant la réponse du
      // support : refuser en local un 0 qui passerait est réparable en une
      // seconde ; laisser partir un 0 qui casse coûte un aller-retour.
      err(
        'durationMonths',
        `La durée du contrat doit être un nombre de mois entre ${ADEP_LIMITS.durationMin} et ${ADEP_LIMITS.durationMax}.`,
        '394',
      );
    }
  }

  if (offer.partTime) {
    if (!offer.partTimeDuration) {
      err('partTimeDuration', 'Un poste à temps partiel doit préciser sa modalité.', '400');
    } else if (
      !(TEMPS_PARTIEL_DUREE_CODES as readonly string[]).includes(offer.partTimeDuration)
    ) {
      err('partTimeDuration', "La modalité de temps partiel n'est pas une valeur acceptée.", '400');
    }
  } else if (offer.partTimeDuration) {
    warn(
      'partTimeDuration',
      "Une modalité de temps partiel est renseignée alors que le poste est à temps plein — elle ne sera pas prise en compte.",
      '405',
    );
  }

  if (offer.remoteWork && !(TELETRAVAIL_CODES as readonly string[]).includes(offer.remoteWork)) {
    err('remoteWork', "Le type de télétravail n'est pas une valeur acceptée.", '023');
  }

  // Stage : niveau d'étude obligatoire (ERECRUT_STAGE_418).
  if (offer.jobType === '9' && !offer.educationLevel) {
    err('educationLevel', "Une offre de stage doit préciser le niveau d'étude attendu.", '418');
  }
  if (
    offer.educationLevel &&
    !(NIVEAU_ETUDE_CODES as readonly string[]).includes(offer.educationLevel)
  ) {
    err('educationLevel', "Le niveau d'étude n'est pas une valeur acceptée.", '418');
  }

  // ── Rémunération ─────────────────────────────────────────────────────────
  if (!(SALAIRE_TEXTE_CODES as readonly string[]).includes(offer.displayedPay)) {
    err('displayedPay', "Le mode d'affichage du salaire n'est pas une valeur acceptée.", '412');
  }
  const isInternship = offer.jobType === '9';
  if (!isInternship) {
    if (offer.salaryMin == null) {
      err('salaryMin', 'Le salaire minimum est obligatoire pour une offre d’emploi.', '317');
    }
    if (offer.salaryMax == null) {
      err('salaryMax', 'Le salaire maximum est obligatoire pour une offre d’emploi.', '318');
    }
  }
  for (const [field, value, code] of [
    ['salaryMin', offer.salaryMin, '317'],
    ['salaryMax', offer.salaryMax, '318'],
  ] as const) {
    if (value == null) continue;
    if (!Number.isInteger(value) || value < 0) {
      err(field, 'Le salaire doit être un montant entier en euros.', code);
    } else if (String(value).length > ADEP_LIMITS.salaryDigitsMax) {
      err(field, `Le salaire dépasse ${ADEP_LIMITS.salaryDigitsMax} chiffres.`, code);
    }
  }
  if (
    offer.salaryMin != null &&
    offer.salaryMax != null &&
    offer.salaryMin > offer.salaryMax
  ) {
    err('salaryMax', 'Le salaire maximum est inférieur au salaire minimum.', '318');
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  if (offer.datePositionTaken) {
    if (!DATE_SHAPE.test(offer.datePositionTaken)) {
      err('datePositionTaken', 'La date de prise de poste doit être au format AAAA-MM-JJ.', '402');
    } else if (daysBetween(today, offer.datePositionTaken) < 0) {
      err('datePositionTaken', 'La date de prise de poste est dans le passé.', '402');
    }
  }
  if (offer.releaseDate) {
    if (!DATE_SHAPE.test(offer.releaseDate)) {
      err('releaseDate', 'La date de publication doit être au format AAAA-MM-JJ.', '403');
    } else {
      const delta = daysBetween(today, offer.releaseDate);
      if (delta < 0) {
        err('releaseDate', 'La date de publication est dans le passé.', '403');
      } else if (delta > ADEP_LIMITS.releaseDateHorizonDays) {
        err(
          'releaseDate',
          `La date de publication ne peut pas dépasser J+${ADEP_LIMITS.releaseDateHorizonDays}.`,
          '403',
        );
      }
      if (
        offer.datePositionTaken &&
        DATE_SHAPE.test(offer.datePositionTaken) &&
        daysBetween(offer.releaseDate, offer.datePositionTaken) <= 0
      ) {
        err(
          'releaseDate',
          'La date de publication doit précéder la date de prise de poste.',
          '403',
        );
      }
    }
  }

  // ── Textes ───────────────────────────────────────────────────────────────
  if (!(POSITION_TYPES as readonly string[]).includes(offer.positionType)) {
    err('positionType', "Le type d'offre doit être ODD ou ODC.", '322');
  }
  checkRange(
    'positionDescription',
    offer.positionDescription,
    ADEP_LIMITS.positionDescriptionMin,
    ADEP_LIMITS.positionDescriptionMax,
    'Le descriptif du poste',
    { short: '337', long: '331', empty: '332' },
    err,
  );
  checkRange(
    'profileDescription',
    offer.profileDescription,
    ADEP_LIMITS.profileDescriptionMin,
    ADEP_LIMITS.profileDescriptionMax,
    'La description du profil',
    { short: '408', long: '408', empty: '408' },
    err,
  );
  checkRange(
    'organizationDescription',
    offer.organizationDescription,
    ADEP_LIMITS.organizationDescriptionMin,
    ADEP_LIMITS.organizationDescriptionMax,
    "La description de l'entreprise",
    { short: '407', long: '407', empty: '407' },
    err,
  );

  if (len(offer.organizationName) === 0) {
    err('organizationName', "L'enseigne affichée est obligatoire.", '406');
  } else if (len(offer.organizationName) > ADEP_LIMITS.organizationNameMax) {
    err(
      'organizationName',
      `L'enseigne affichée dépasse ${ADEP_LIMITS.organizationNameMax} caractères.`,
      '406',
    );
  }

  if (
    offer.presentationDescription &&
    len(offer.presentationDescription) > ADEP_LIMITS.presentationDescriptionMax
  ) {
    err(
      'presentationDescription',
      `Les conseils aux candidats dépassent ${ADEP_LIMITS.presentationDescriptionMax} caractères.`,
      '409',
    );
  }
  if (
    offer.recruitmentDescription &&
    len(offer.recruitmentDescription) > ADEP_LIMITS.recruitmentDescriptionMax
  ) {
    err(
      'recruitmentDescription',
      `Le processus de recrutement dépasse ${ADEP_LIMITS.recruitmentDescriptionMax} caractères.`,
      '410',
    );
  }
  if (offer.videoUrl && !VIDEO_HOSTS.test(offer.videoUrl.trim())) {
    err(
      'videoUrl',
      "L'URL de la vidéo doit pointer vers YouTube, Vimeo ou Dailymotion.",
      '411',
    );
  }

  // ── Candidatures ─────────────────────────────────────────────────────────
  const email = offer.applicationEmail.trim();
  if (!email) {
    err(
      'applicationEmail',
      "Aucune adresse de réception des candidatures : associez une boîte mail à la campagne.",
      '378',
    );
  } else {
    if (!EMAIL_SHAPE.test(email)) {
      err('applicationEmail', "L'adresse de réception des candidatures est mal formée.", '308');
    }
    if (email.length > ADEP_LIMITS.applicationEmailMax) {
      err(
        'applicationEmail',
        `L'adresse de réception dépasse ${ADEP_LIMITS.applicationEmailMax} caractères.`,
        '379',
      );
    }
  }
  if (offer.applicationUrl) {
    if (offer.positionType === 'ODC') {
      // Le constructeur ne l'émet pas — mais le dire ici évite au recruteur de
      // croire que son URL est partie.
      warn(
        'applicationUrl',
        "Une offre confidentielle n'accepte pas d'URL de candidature : elle ne sera pas envoyée.",
        '1336',
      );
    } else if (!/^https?:\/\//i.test(offer.applicationUrl.trim())) {
      err('applicationUrl', "L'URL de candidature doit commencer par http:// ou https://.", '304');
    } else if (offer.applicationUrl.trim().length > ADEP_LIMITS.applicationUrlMax) {
      err('applicationUrl', "L'URL de candidature est trop longue.", '304');
    }
  }

  if (offer.applyContact) {
    const c = offer.applyContact;
    if (!(CIVILITE_CODES as readonly string[]).includes(c.civility)) {
      err('applyContact.civility', "La civilité du contact n'est pas une valeur acceptée.", '313');
    }
    if (len(c.givenName) === 0 || len(c.familyName) === 0 || len(c.qualification) === 0) {
      err(
        'applyContact',
        'Le contact de suivi doit être complet : civilité, prénom, nom et fonction — ou entièrement vide.',
        '404',
      );
    }
    if (len(c.givenName) > ADEP_LIMITS.contactNameMax) {
      err('applyContact.givenName', `Le prénom dépasse ${ADEP_LIMITS.contactNameMax} caractères.`, '382');
    }
    if (len(c.familyName) > ADEP_LIMITS.contactNameMax) {
      err('applyContact.familyName', `Le nom dépasse ${ADEP_LIMITS.contactNameMax} caractères.`, '383');
    }
    if (len(c.qualification) > ADEP_LIMITS.contactQualificationMax) {
      err(
        'applyContact.qualification',
        `La fonction dépasse ${ADEP_LIMITS.contactQualificationMax} caractères.`,
        '404',
      );
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

function checkRange(
  field: string,
  value: string,
  min: number,
  max: number,
  label: string,
  codes: { short: string; long: string; empty: string },
  err: (field: string, message: string, code: string) => void,
): void {
  const size = len(value);
  if (size === 0) {
    err(field, `${label} est obligatoire.`, codes.empty);
    return;
  }
  if (size < min) {
    err(
      field,
      `${label} doit faire au moins ${min} caractères (${size} actuellement).`,
      codes.short,
    );
  } else if (size > max) {
    err(
      field,
      `${label} dépasse ${max} caractères (${size} actuellement).`,
      codes.long,
    );
  }
}

/** Clé de Luhn — contrôle usuel d'un SIRET. PUR. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const position = digits.length - 1 - i;
    const digit = Number(digits[position]);
    if (Number.isNaN(digit)) return false;
    if (i % 2 === 1) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return sum % 10 === 0;
}
