/**
 * Offre d'exemple — le jeu d'essai partagé du connecteur ADEP.
 *
 * Une offre VALIDE et plausible : un consultant AMOA en Indre-et-Loire, en
 * mode client direct. Les textes atteignent les minimums réels (200 / 100 /
 * 100 caractères) parce qu'un jeu d'essai qui ne les atteint pas ne prouve
 * rien du validateur.
 */

import type { AdepOffer } from '@/types/adep';

export const SAMPLE_POSITION_DESCRIPTION = [
  "Notre client, cabinet de conseil reconnu sur les métiers de la finance de marché, renforce son équipe AMOA en Indre-et-Loire.",
  "Vous intervenez sur des projets de transformation du système d'information : recueil et formalisation du besoin métier, rédaction des spécifications fonctionnelles, animation des ateliers utilisateurs, recette et accompagnement au changement.",
  "Vous êtes l'interlocuteur privilégié des directions métier comme des équipes techniques, et vous portez la cohérence fonctionnelle des solutions livrées.",
].join(' ');

export const SAMPLE_PROFILE_DESCRIPTION = [
  "De formation supérieure (bac+5, école de commerce, d'ingénieurs ou université), vous justifiez d'au moins trois ans d'expérience en AMOA sur des projets SI.",
  'La connaissance du Trade Finance est un vrai plus. Rigueur, sens du dialogue et goût du travail en équipe feront la différence.',
].join(' ');

export const SAMPLE_ORGANIZATION_DESCRIPTION = [
  'QWESTINUM accompagne depuis dix ans les directions métier dans la transformation de leurs processus.',
  'Nos consultants interviennent auprès de grands comptes comme de PME, sur des missions de conseil, de cadrage et de conduite du changement.',
].join(' ');

export const SAMPLE_OFFER: AdepOffer = {
  clientPositionId: 'CAMP-2026-288',
  trackingId: 'orqa-CAMP-2026-288-1757000000000',

  relationship: 'self',
  finalClient: null,
  contactEmail: null,

  positionTitle: 'Consultant AMOA Trade Finance',
  nafCode: '7022Z',
  inseeCode: '37261', // Tours
  travelZone: 'REGIONAL',
  experienceLevel: '5', // Minimum 3 ans
  numberToFill: 1,

  jobType: '1', // CDI
  statusJob: 'CADRE_PRIVE',
  durationMonths: null, // interdit en CDI
  partTime: false,
  partTimeDuration: null,
  remoteWork: 'PARTIEL_POSSIBLE',
  educationLevel: null,

  salaryMin: 45000,
  salaryMax: 55000,
  displayedPay: '2', // X – Y k€ brut annuel

  datePositionTaken: '2026-11-02',
  releaseDate: '2026-09-15',

  positionType: 'ODD',
  positionDescription: SAMPLE_POSITION_DESCRIPTION,
  profileDescription: SAMPLE_PROFILE_DESCRIPTION,
  organizationDescription: SAMPLE_ORGANIZATION_DESCRIPTION,
  organizationName: 'QWESTINUM',
  displayLogo: true,
  presentationDescription: null,
  recruitmentDescription: null,
  videoUrl: null,

  applicationEmail: 'recrutement@qwestinum.fr',
  applicationUrl: null,
  applyContact: null,
};

/** Le même poste, mais confié par un client réel (mode indirect). */
export const SAMPLE_OFFER_BROKER: AdepOffer = {
  ...SAMPLE_OFFER,
  relationship: 'broker',
  finalClient: {
    organizationName: 'BANQUE DE LOIRE',
    siret: '55208131766522',
    nafCode: '6419Z',
  },
};

/** Identité d'appel de test — aucune valeur réelle. */
export const SAMPLE_CREDENTIALS = {
  atsId: '50',
  numeroDossier: '123456789W',
  atsPassword: 'x'.repeat(342),
};

/** Date de référence des tests : les règles de date sont injectées, jamais lues. */
export const SAMPLE_TODAY = '2026-09-08';
