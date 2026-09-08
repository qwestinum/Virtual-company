/**
 * Modèle d'une offre APEC prête à partir — l'entrée du constructeur XML SEP.
 *
 * C'est un objet PLAT et déjà TRADUIT : les codes de domaine y sont posés
 * (`jobType: '1'`, pas `contractType: 'CDI'`), les montants sont des entiers,
 * le lieu est un code INSEE. Toute la conversion depuis la campagne ORQA se
 * fait AVANT, dans le mapping — pour que le constructeur n'ait aucune décision
 * métier à prendre et reste testable ligne à ligne.
 *
 * Rien ici ne porte de secret : `atsPassword` et `numeroDossier` voyagent dans
 * `AdepCredentials`, séparément, pour qu'un snapshot d'offre puisse être
 * journalisé tel quel.
 */

import { z } from 'zod';

import {
  CIVILITE_CODES,
  NIVEAU_ETUDE_CODES,
  NIVEAU_EXPERIENCE_CODES,
  POSITION_TYPES,
  SALAIRE_TEXTE_CODES,
  STATUT_POSTE_CODES,
  TELETRAVAIL_CODES,
  TEMPS_PARTIEL_DUREE_CODES,
  TYPE_CONTRAT_CODES,
  ZONE_DEPLACEMENT_CODES,
} from '@/lib/jobboards/adep/domains';

/** Identité d'appel. JAMAIS journalisée, JAMAIS renvoyée au navigateur. */
export type AdepCredentials = {
  atsId: string;
  /** Identifiant Apec du RECRUTEUR (`123456789W`) — donnée personnelle. */
  numeroDossier: string;
  /** Clé Argon2id, base64 sans padding (342 caractères). */
  atsPassword: string;
};

/** Bloc « client réel » — mode indirect (cabinet recrutant pour un client). */
export const AdepFinalClientSchema = z.object({
  /** Raison sociale. ⚠️ 38 caractères — ce n'est PAS l'enseigne affichée. */
  organizationName: z.string().min(1),
  /** SIRET, 14 chiffres. */
  siret: z.string(),
  /** Code NAF du client réel. */
  nafCode: z.string(),
});
export type AdepFinalClient = z.infer<typeof AdepFinalClientSchema>;

/** Contact de suivi des candidatures — tout ou rien (API_404). */
export const AdepApplyContactSchema = z.object({
  civility: z.enum(CIVILITE_CODES),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  /** Fonction. 80 caractères (catalogue) — la spec dit 128, on prend le plus strict. */
  qualification: z.string().min(1),
});
export type AdepApplyContact = z.infer<typeof AdepApplyContactSchema>;

export const AdepOfferSchema = z.object({
  // ── Identité de la transaction ─────────────────────────────────────────
  /** Référence CLIENT, ≤ 20 car., unique chez Apec à jamais. `CAMP-YYYY-NNN`. */
  clientPositionId: z.string().min(1),
  /** Identifiant de transaction, ≤ 100 car., différent à CHAQUE requête. */
  trackingId: z.string().min(1),

  // ── Mode ───────────────────────────────────────────────────────────────
  /** `self` = client direct, `broker` = client indirect. */
  relationship: z.enum(['self', 'broker']),
  /** Requis (et seulement valide) en mode `broker`. */
  finalClient: AdepFinalClientSchema.nullable(),
  /** Courriel de l'interlocuteur, mode direct. Vide ⇒ défaut Apec. */
  contactEmail: z.string().nullable(),

  // ── Le poste ───────────────────────────────────────────────────────────
  /** Intitulé SANS la mention H/F — le constructeur l'ajoute (cf. §4.1). */
  positionTitle: z.string().min(1),
  /** Code NAF de l'entreprise interlocutrice. */
  nafCode: z.string().min(1),
  /** Code commune INSEE (hors 75056 / 69123 / 13055). */
  inseeCode: z.string().min(1),
  travelZone: z.enum(ZONE_DEPLACEMENT_CODES),
  experienceLevel: z.enum(NIVEAU_EXPERIENCE_CODES),
  numberToFill: z.number().int(),

  // ── Contrat ────────────────────────────────────────────────────────────
  jobType: z.enum(TYPE_CONTRAT_CODES),
  statusJob: z.enum(STATUT_POSTE_CODES),
  /** Durée en mois. `null` pour un CDI (interdit — API_397). */
  durationMonths: z.number().int().nullable(),
  partTime: z.boolean(),
  partTimeDuration: z.enum(TEMPS_PARTIEL_DUREE_CODES).nullable(),
  remoteWork: z.enum(TELETRAVAIL_CODES).nullable(),
  /** Niveau d'étude — offre de STAGE uniquement. */
  educationLevel: z.enum(NIVEAU_ETUDE_CODES).nullable(),

  // ── Rémunération ───────────────────────────────────────────────────────
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  displayedPay: z.enum(SALAIRE_TEXTE_CODES),

  // ── Dates (`YYYY-MM-DD`) ───────────────────────────────────────────────
  datePositionTaken: z.string().nullable(),
  releaseDate: z.string().nullable(),

  // ── Textes ─────────────────────────────────────────────────────────────
  positionType: z.enum(POSITION_TYPES),
  /** 200 – 3000 caractères. */
  positionDescription: z.string(),
  /** 100 – 3000 caractères. */
  profileDescription: z.string(),
  /** 100 – 3000 caractères. */
  organizationDescription: z.string(),
  /** Enseigne affichée, ≤ 255 caractères. */
  organizationName: z.string(),
  displayLogo: z.boolean(),
  /** ≤ 500 caractères. */
  presentationDescription: z.string().nullable(),
  /** ≤ 500 caractères. */
  recruitmentDescription: z.string().nullable(),
  videoUrl: z.string().nullable(),

  // ── Candidatures ───────────────────────────────────────────────────────
  /** Adresse de réception — la boîte IMAP de la campagne. ≤ 240 car. */
  applicationEmail: z.string(),
  /** URL de candidature. Interdite en ODC (API_1336). */
  applicationUrl: z.string().nullable(),
  applyContact: AdepApplyContactSchema.nullable(),
});

export type AdepOffer = z.infer<typeof AdepOfferSchema>;

/** Statuts d'une offre chez Apec (`STATUT_OFFRE_DOMAIN`). */
export const ADEP_POSITION_STATUSES = [
  'AVALIDER',
  'PUBLIEE',
  'SUSPENDUE',
  'AMODIFIER',
  'FERMEE',
] as const;
export type AdepPositionStatus = (typeof ADEP_POSITION_STATUSES)[number];

/** Sévérités d'exception de l'acquittement HR-XML. */
export const ADEP_SEVERITIES = ['Informational', 'Warning', 'Fatal'] as const;
export type AdepSeverity = (typeof ADEP_SEVERITIES)[number];

/** Une exception isolée de l'acquittement. */
export type AdepException = {
  /** Code numérique du catalogue (`330`). `null` si l'Apec l'omet. */
  code: string | null;
  severity: AdepSeverity;
  /** Nom brut (`API_330_CLIENT_INDIRECT_ACCESS_ERROR`). */
  message: string;
  /** Entité concernée (`Staffing Order`), telle que rendue. */
  entity: string | null;
  /** XPath de l'instance fautive — le champ, quand l'Apec le donne. */
  xpath: string | null;
};

/** Acquittement lu. `ok` est le VERDICT, pas un décompte. */
export type AdepAcknowledgement = {
  /** Vrai si et seulement si AUCUNE exception `Fatal`. */
  ok: boolean;
  /** Notre identifiant de transaction, tel que l'Apec le renvoie. */
  trackingId: string | null;
  /** Numéro Apec de l'offre. Absent quand rien n'a été créé. */
  apecPositionNumero: string | null;
  /** TOUTES les exceptions, y compris `Warning` et `Informational`. */
  exceptions: AdepException[];
};

/** Réponse de `getPositionStatus` pour une offre. */
export type AdepPositionStatusResult = {
  apecPositionNumero: string;
  clientPositionId: string;
  status: AdepPositionStatus | string;
  isEditable: boolean;
  positionUrl: string;
};
