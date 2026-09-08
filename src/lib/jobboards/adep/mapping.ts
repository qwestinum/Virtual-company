/**
 * Campagne ORQA → brouillon d'offre APEC. PUR.
 *
 * ── CE QUE CE MODULE FAIT, ET SURTOUT CE QU'IL NE FAIT PAS ──────────────────
 *
 * Il PROPOSE. Il ne décide jamais à la place de l'humain, et il ne devine
 * jamais en silence. Trois natures de champ sortent d'ici :
 *
 *   · `certain`   — la valeur vient directement d'ORQA, sans perte (l'intitulé,
 *                   l'adresse de candidature) ;
 *   · `derived`   — une traduction a eu lieu et elle est APPROXIMATIVE
 *                   (« confirmé » → « minimum 3 ans »). L'écran l'affiche avec
 *                   sa provenance, et l'humain confirme ou corrige ;
 *   · `missing`   — ORQA ne possède pas l'information (code INSEE, statut du
 *                   poste). Champ vide, saisie humaine.
 *
 * C'est le même geste que le pré-remplissage par document : une valeur suggérée
 * doit être TRAITÉE avant de partir. Une conversion qui se présenterait comme
 * un fait ferait publier « minimum 3 ans » sur un poste ouvert aux débutants,
 * sans que personne ne l'ait décidé.
 *
 * ── LES TROIS TRADUCTIONS QUI NE TOMBENT PAS JUSTE ──────────────────────────
 *
 * Le contrat, l'expérience et le salaire. Chacune est documentée à son
 * endroit ; le point commun est qu'aucune n'est réversible, et qu'aucune ne
 * doit être appliquée en silence.
 */

import { asContractList } from '@/lib/fdp/contract-type';
import type { AdepOffer } from '@/types/adep';
import type { AdepConfig } from '@/types/adep-settings';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';

/** Nature d'une valeur proposée. */
export type AdepFieldOrigin = 'certain' | 'derived' | 'missing';

export type AdepFieldNote = {
  origin: AdepFieldOrigin;
  /** D'où vient la valeur, en français — affiché sous le champ. */
  from?: string;
};

/**
 * Le brouillon. Les champs que l'humain doit trancher sont `null` : un
 * brouillon ne prétend jamais être une offre complète.
 */
export type AdepDraft = {
  offer: AdepDraftOffer;
  /** Provenance par champ, pour que l'écran dise d'où sort chaque valeur. */
  notes: Partial<Record<keyof AdepOffer, AdepFieldNote>>;
  /**
   * Ce qui empêche de publier et qu'aucune saisie ne réglera dans ce
   * formulaire — un contrat que l'Apec ne diffuse pas, une boîte mail non
   * associée. Dit AVANT, jamais au moment de l'envoi.
   */
  blockers: string[];
};

/** L'offre en cours de construction : tout ce qui n'est pas résolu est `null`. */
export type AdepDraftOffer = Omit<
  AdepOffer,
  | 'jobType'
  | 'statusJob'
  | 'experienceLevel'
  | 'inseeCode'
  | 'salaryMin'
  | 'salaryMax'
  | 'trackingId'
> & {
  jobType: AdepOffer['jobType'] | null;
  statusJob: AdepOffer['statusJob'] | null;
  experienceLevel: AdepOffer['experienceLevel'] | null;
  inseeCode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
};

// ── Contrat ─────────────────────────────────────────────────────────────────

/**
 * Correspondances CERTAINES seulement.
 *
 * `alternance` et `apprentissage` sont volontairement absents : l'Apec
 * distingue la BASE (CDI ou CDD) et le TYPE (apprentissage ou
 * professionnalisation), et ORQA n'a ni l'une ni l'autre. Proposer « 6 » au
 * hasard publierait un CDD là où le cabinet voulait un CDI.
 */
const CERTAIN_CONTRACTS: Record<string, AdepOffer['jobType']> = {
  cdi: '1',
  cdd: '5',
  stage: '9',
  interim: '8',
  "mission d'interim": '8',
};

/** Contrats qu'ORQA connaît et que l'Apec ne diffuse PAS. */
const UNSUPPORTED_CONTRACTS = new Set([
  'freelance',
  'portage salarial',
  'cdi de chantier',
]);

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export type ContractMapping =
  | { kind: 'certain'; jobType: AdepOffer['jobType']; label: string }
  /** Plusieurs codes Apec possibles — l'humain tranche. */
  | { kind: 'ambiguous'; reason: string }
  /** L'Apec ne diffuse pas ce contrat. Bloquant. */
  | { kind: 'unsupported'; reason: string }
  | { kind: 'unknown' };

/**
 * Traduit le champ contrat d'ORQA. PUR.
 *
 * Le champ est MULTI-VALEUR (« CDI ou CDD ») alors que l'Apec n'en accepte
 * qu'un : une liste à plusieurs entrées est donc toujours ambiguë, même quand
 * chaque entrée est traduisible.
 */
export function mapContractType(value: unknown): ContractMapping {
  const list = asContractList(value);
  if (list.length === 0) return { kind: 'unknown' };

  const unsupported = list.filter((c) => UNSUPPORTED_CONTRACTS.has(fold(c)));
  if (unsupported.length === list.length) {
    return {
      kind: 'unsupported',
      reason: `L'Apec ne diffuse pas d'offre en ${list.join(' ni en ')}.`,
    };
  }

  if (list.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `La fiche de poste accepte ${list.join(', ')} ; l'Apec n'en publie qu'un.`,
    };
  }

  const only = list[0]!;
  const certain = CERTAIN_CONTRACTS[fold(only)];
  if (certain) return { kind: 'certain', jobType: certain, label: only };

  if (fold(only).includes('alternance') || fold(only).includes('apprentissage')) {
    return {
      kind: 'ambiguous',
      reason:
        "L'Apec distingue l'alternance en CDI ou en CDD, et l'apprentissage de " +
        'la professionnalisation. La fiche de poste ne le précise pas.',
    };
  }

  return { kind: 'unknown' };
}

// ── Expérience ──────────────────────────────────────────────────────────────

/**
 * Séniorité ORQA → `NIVEAU_EXPERIENCE_DOMAIN`.
 *
 * Trois valeurs contre douze : la conversion perd de l'information dans les
 * deux sens, et c'est pour cela qu'elle sort en `derived` et non en `certain`.
 * Les correspondances retenues sont les plus proches du sens courant, pas les
 * plus généreuses — proposer « tous niveaux acceptés » pour un poste senior
 * ferait arriver des candidatures que le cabinet n'attend pas.
 */
const SENIORITY_TO_EXPERIENCE: Record<string, AdepOffer['experienceLevel']> = {
  junior: '2', // Aucune expérience exigée
  confirme: '5', // Minimum 3 ans
  senior: '7', // Minimum 5 ans
};

export function mapSeniority(value: unknown): AdepOffer['experienceLevel'] | null {
  if (typeof value !== 'string') return null;
  return SENIORITY_TO_EXPERIENCE[fold(value)] ?? null;
}

// ── Salaire ─────────────────────────────────────────────────────────────────

export type SalaryMapping =
  | { kind: 'parsed'; min: number; max: number; label: string }
  | { kind: 'unparseable' };

/**
 * Lit une fourchette écrite à la main. PUR.
 *
 * `salary_range` est du texte libre : « 45-55 k€ », « 45000 à 55000 € brut »,
 * « selon profil ». On reconnaît les formes courantes et on ABANDONNE
 * franchement sur le reste — un montant deviné est pire qu'un champ vide, parce
 * qu'il part sans que personne ne le relise.
 *
 * Les « k » sont multipliés par 1000. Un nombre seul donne une fourchette
 * plate (min = max) : l'Apec exige les deux bornes, et inventer un écart de
 * 10 % serait exactement le genre de supposition qu'on s'interdit.
 */
export function mapSalaryRange(value: unknown): SalaryMapping {
  if (typeof value !== 'string') return { kind: 'unparseable' };
  const text = value.trim();
  if (!text) return { kind: 'unparseable' };

  // Les nombres, chacun avec son éventuel suffixe « k ».
  const parsed = [...text.matchAll(/(\d[\d\s.,]*)\s*(k)?/gi)]
    .map((m) => {
      const raw = (m[1] ?? '').replace(/[\s.,]/g, '');
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      return { value: n, explicitK: Boolean(m[2]) };
    })
    .filter((n): n is { value: number; explicitK: boolean } => n !== null);

  if (parsed.length === 0) return { kind: 'unparseable' };

  // ⚠️ L'UNITÉ EST SOUVENT ÉCRITE UNE SEULE FOIS, À LA FIN.
  // « 45 - 55 k€ » : le « k » porte sur les DEUX bornes. Lire le 45 tel quel
  // le fait tomber sous le seuil de plausibilité, la fourchette s'écrase sur
  // 55 000 – 55 000, et le salaire minimum publié devient faux — sans que rien
  // ne le signale, puisque le résultat reste un nombre crédible. C'est la
  // forme la PLUS courante en français, donc le cas à traiter, pas l'exception.
  const someExplicitK = parsed.some((n) => n.explicitK);
  const amounts = parsed.map((n) => {
    if (n.explicitK) return n.value * 1000;
    // Le « k » sous-entendu : « 45 » dans « 45 - 55 k€ ».
    if (someExplicitK && n.value < 1000) return n.value * 1000;
    return n.value;
  });

  // Un montant à trois chiffres ou moins, sans « k » nulle part, n'est pas un
  // salaire annuel : c'est autre chose (des heures, un pourcentage, un effectif).
  const plausible = amounts.filter((n) => n >= 1000);
  if (plausible.length === 0) return { kind: 'unparseable' };

  const min = Math.min(...plausible);
  const max = Math.max(...plausible);
  return { kind: 'parsed', min, max, label: text };
}

// ── Le brouillon ────────────────────────────────────────────────────────────

export type AdepDraftInput = {
  campaignId: string;
  fdp: FDPInProgress;
  config: AdepConfig;
  /** Enseigne affichée — `interviewConfig.organisationName`, canonique. */
  organizationName: string;
  /** Corps de l'annonce validée. */
  positionDescription: string;
  /** Description du profil recherché. */
  profileDescription: string;
  /** Boîte de réception de la campagne. Vide ⇒ bloquant. */
  applicationEmail: string;
  /** Code INSEE du site de rattachement, quand il est renseigné. */
  siteInseeCode?: string | null;
  /** Référence client — `CAMP-YYYY-NNN`, avec suffixe de republication. */
  clientReference: string;
};

function fieldValue(fdp: FDPInProgress, key: FieldKey): unknown {
  return fdp.fields[key]?.value;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Construit le brouillon proposé à l'écran. PUR. */
export function buildAdepDraft(input: AdepDraftInput): AdepDraft {
  const notes: AdepDraft['notes'] = {};
  const blockers: string[] = [];

  const jobTitle = asText(fieldValue(input.fdp, 'job_title'));
  notes.positionTitle = jobTitle
    ? { origin: 'certain', from: 'intitulé de la fiche de poste' }
    : { origin: 'missing' };

  // ── Contrat ──
  const contract = mapContractType(fieldValue(input.fdp, 'contract_type'));
  let jobType: AdepOffer['jobType'] | null = null;
  switch (contract.kind) {
    case 'certain':
      jobType = contract.jobType;
      notes.jobType = { origin: 'certain', from: `« ${contract.label} » de la fiche de poste` };
      break;
    case 'ambiguous':
      notes.jobType = { origin: 'missing', from: contract.reason };
      break;
    case 'unsupported':
      notes.jobType = { origin: 'missing', from: contract.reason };
      blockers.push(contract.reason);
      break;
    case 'unknown':
      notes.jobType = { origin: 'missing' };
      break;
  }

  // ── Expérience ──
  const seniorityRaw = asText(fieldValue(input.fdp, 'seniority'));
  const experienceLevel = mapSeniority(seniorityRaw);
  notes.experienceLevel = experienceLevel
    ? { origin: 'derived', from: `séniorité « ${seniorityRaw} »` }
    : { origin: 'missing' };

  // ── Salaire ──
  const salary = mapSalaryRange(fieldValue(input.fdp, 'salary_range'));
  const salaryMin = salary.kind === 'parsed' ? salary.min : null;
  const salaryMax = salary.kind === 'parsed' ? salary.max : null;
  const salaryNote: AdepFieldNote =
    salary.kind === 'parsed'
      ? { origin: 'derived', from: `fourchette « ${salary.label} »` }
      : { origin: 'missing' };
  notes.salaryMin = salaryNote;
  notes.salaryMax = salaryNote;

  // ── Lieu ──
  const inseeCode = input.siteInseeCode?.trim() || null;
  notes.inseeCode = inseeCode
    ? { origin: 'derived', from: 'code INSEE du site de rattachement' }
    : {
        origin: 'missing',
        from: `la fiche de poste indique « ${asText(fieldValue(input.fdp, 'location')) || 'aucun lieu'} », l'Apec attend un code commune`,
      };

  // ── Date de prise de poste ──
  const startDate = asText(fieldValue(input.fdp, 'start_date'));
  const datePositionTaken = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  if (datePositionTaken) {
    notes.datePositionTaken = { origin: 'certain', from: 'date cible de la fiche de poste' };
  }

  // ── Ce qui ne se règle pas dans ce formulaire ──
  if (!input.applicationEmail.trim()) {
    blockers.push(
      "Aucune boîte mail n'est associée à cette campagne : les candidatures n'auraient nulle part où arriver.",
    );
  }

  const offer: AdepDraftOffer = {
    clientPositionId: input.clientReference,

    relationship: input.config.clientMode,
    finalClient: null,
    contactEmail: null,

    positionTitle: jobTitle,
    nafCode: input.config.nafCode,
    inseeCode,
    travelZone: input.config.defaultTravelZone,
    experienceLevel,
    numberToFill: 1,

    jobType,
    statusJob: input.config.defaultStatusJob,
    durationMonths: null,
    partTime: false,
    partTimeDuration: null,
    remoteWork: null,
    educationLevel: null,

    salaryMin,
    salaryMax,
    displayedPay: input.config.defaultDisplayedPay,

    datePositionTaken,
    releaseDate: null,

    positionType: 'ODD',
    positionDescription: input.positionDescription,
    profileDescription: input.profileDescription,
    organizationDescription: input.config.organizationDescription,
    organizationName: input.organizationName,
    displayLogo: input.config.displayLogo,
    presentationDescription: input.config.presentationDescription || null,
    recruitmentDescription: input.config.recruitmentDescription || null,
    videoUrl: null,

    applicationEmail: input.applicationEmail,
    applicationUrl: null,
    applyContact: null,
  };

  notes.nafCode = input.config.nafCode
    ? { origin: 'certain', from: 'réglages APEC du cabinet' }
    : { origin: 'missing', from: 'à renseigner dans les réglages du cabinet' };
  notes.organizationDescription = { origin: 'certain', from: 'réglages APEC du cabinet' };
  notes.organizationName = { origin: 'certain', from: "nom d'organisation des paramètres" };
  notes.travelZone = { origin: 'derived', from: 'valeur par défaut des réglages' };
  notes.statusJob = { origin: 'derived', from: 'valeur par défaut des réglages' };
  notes.displayedPay = { origin: 'derived', from: 'valeur par défaut des réglages' };
  notes.applicationEmail = input.applicationEmail
    ? { origin: 'certain', from: 'boîte mail de la campagne' }
    : { origin: 'missing' };

  return { offer, notes, blockers };
}

/**
 * Le brouillon est-il complet ? PUR.
 *
 * Complet ≠ valide : la validation métier (`validateAdepOffer`) travaille sur
 * une offre COMPLÈTE. Cette fonction dit seulement si l'on peut la lui donner.
 */
export function completeDraft(
  draft: AdepDraftOffer,
  trackingId: string,
): AdepOffer | null {
  if (
    draft.jobType == null ||
    draft.statusJob == null ||
    draft.experienceLevel == null ||
    draft.inseeCode == null
  ) {
    return null;
  }
  return {
    ...draft,
    jobType: draft.jobType,
    statusJob: draft.statusJob,
    experienceLevel: draft.experienceLevel,
    inseeCode: draft.inseeCode,
    salaryMin: draft.salaryMin,
    salaryMax: draft.salaryMax,
    trackingId,
  };
}
