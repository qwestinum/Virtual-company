/**
 * Module Sourcing — modèle partagé.
 * Spec : docs/specs/sourcing.md (§7 données, §2-3 requêtage).
 */

export type SourcingLanguage = 'fr' | 'en';

export type SourcingProfileState = 'reserve' | 'to_review' | 'contacted';

export type QueryMethod = 'llm' | 'deterministic';

/** Ce que le générateur de requête lit d'une campagne — rien d'autre. */
export type QueryFicheInput = {
  jobTitle: string;
  seniority: string | null;
  location: string | null;
  criteria: { id: string; label: string; level: string; keywords?: string[] }[];
};

export type NotEncodedCriterion = { label: string; reason: string };

/** Ce que l'écran du recruteur reçoit : AUCUN coût (spec §18, ajustement du 14/09). */
export type PublicGeneratedQuery = {
  query: string;
  encoded: string[];
  notEncoded: NotEncodedCriterion[];
  method: QueryMethod;
  language: SourcingLanguage;
  /** Pourquoi le repli a été pris — dit à l'écran, jamais tu. */
  fallbackReason: string | null;
};

/**
 * Côté serveur seulement. Le coût est une donnée d'exploitation, incluse dans
 * l'abonnement : il part au suivi d'administration, jamais à l'écran du recruteur.
 */
export type GeneratedQuery = PublicGeneratedQuery & {
  /** Coût de la génération (0 en repli déterministe). */
  llmCostUsd: number;
};

/**
 * Projection STOCKÉE d'un résultat du moteur (`sourcing_profiles.exa_snapshot`).
 * Liste blanche : un champ absent d'ici n'entre pas en base, quel que soit ce
 * que le moteur renvoie. Construite UNIQUEMENT à partir du texte déjà amputé
 * des sections exclues (`keepAllowedSections`).
 *
 * Lot 2 : identité professionnelle, parcours, formation, résumé. La
 * disponibilité, les mentions et l'email du titulaire arrivent au lot 3.
 */
export type ExaSnapshot = {
  url: string;
  name: string;
  firstName: string | null;
  location: string | null;
  headline: string | null;
  current: { title: string; company: string | null; since: string | null } | null;
  workHistory: {
    title: string;
    company: string | null;
    location: string | null;
    from: string | null;
    to: string | null;
  }[];
  education: {
    degree: string | null;
    institution: string | null;
    from: string | null;
    to: string | null;
  }[];
  about: string | null;
  skills: string | null;
  languages: string | null;
  certifications: string | null;
  highlight: string | null;
  indexedAt: string | null;
  /**
   * Lot 3. Facultatifs : un instantané du lot 2 ne les porte pas, et l'écran
   * doit le lire sans erreur (absence ⇒ ni badge, ni contact).
   */
  contacts?: { emails: string[] };
  availability?: { expression: string; zone: 'title' | 'headline' | 'about' } | null;
};

export type ProfileMention = { criterionId: string; label: string; terms: string[]; found: string[] };

export type SourcingProfileView = {
  id: string;
  searchId: string;
  exaRank: number;
  state: SourcingProfileState;
  snapshot: ExaSnapshot;
  inZone: boolean | null;
  /** Lot 3 — indices de lecture, jamais un verdict. */
  mentions?: ProfileMention[];
  /** Lot 3 — dossier du vivier probablement identique (nom + entreprise). */
  vivierCandidateId?: string | null;
};

export type CoverageVerdict = {
  /** `null` : la fiche ne donne pas de ville — pas de contrôle. */
  zoneLabel: string | null;
  inZone: number;
  total: number;
  limited: boolean;
};

export type SourcingCampaignSummary = {
  campaignId: string;
  name: string;
  /** Même forme que les autres onglets (`ReferentMention`). */
  referent: { id: string; displayName: string; isActive: boolean } | null;
  seen: number;
  approached: number;
  manifested: number;
  lastSearchAt: string | null;
};
