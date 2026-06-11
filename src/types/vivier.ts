/**
 * Types métier du Vivier de candidats (Session V1 — socle).
 * Source de vérité fonctionnelle : docs/specs/vivier.md.
 *
 * Le vivier est un stock interne de dossiers candidats persistants,
 * indépendants des campagnes. L'email (normalisé) est la clé de
 * déduplication (§2.3). Trois objets composent un dossier indexé :
 * le dossier d'identité (stable), l'embedding sémantique et les entités
 * structurées (les deux régénérés à chaque (ré)indexation).
 */

/** Statut d'indexation d'un dossier. `pending`/`failed` ⇒ exclu des recherches. */
export type VivierIndexingStatus = 'pending' | 'indexed' | 'failed';

/**
 * Origine d'entrée d'un dossier. `campaign_application` est préparé pour la
 * V2 (alimentation automatique depuis les flux) — non émis en V1.
 */
export type VivierSource = 'manual_upload' | 'campaign_application';

/** Entités structurées extraites du CV (enrichissement régénérable). */
export type VivierEntities = {
  technologies: string[];
  certifications: string[];
  diplomes: string[];
  secteurs: string[];
  langues: string[];
  /** Durée d'expérience totale estimée en années, ou null si non déterminée. */
  experienceYears: number | null;
  localisation: string | null;
};

/** Entités vides — défaut non bloquant quand l'extraction LLM échoue (§3 livrable 3). */
export const EMPTY_VIVIER_ENTITIES: VivierEntities = {
  technologies: [],
  certifications: [],
  diplomes: [],
  secteurs: [],
  langues: [],
  experienceYears: null,
  localisation: null,
};

/** Le dossier candidat (vue domaine, camelCase). */
export type VivierCandidate = {
  id: string;
  email: string;
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cvPath: string | null;
  cvText: string | null;
  tags: string[];
  source: VivierSource;
  indexingStatus: VivierIndexingStatus;
  indexingError: string | null;
  enteredAt: string;
  updatedAt: string;
};

/** Dossier + entités jointes (vue liste/détail). */
export type VivierCandidateWithEntities = VivierCandidate & {
  entities: VivierEntities | null;
};
