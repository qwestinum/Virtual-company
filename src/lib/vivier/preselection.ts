/**
 * Présélection vivier — REFONTE SUR LE TITRE (docs/specs/vivier.md §4).
 *
 * On abandonne l'embedding full-CV (document long ⇄ requête courte ⇒ similarités
 * tassées, profils hors-domaine en tête). On rapproche le TITRE du candidat de
 * l'INTITULÉ du poste, en deux blocs fusionnés en une liste unique :
 *
 *   Bloc 1 — DÉTERMINISTE (en tête). Les variantes du titre candidat
 *     confrontées à {intitulé du poste} ∪ {variantes de l'intitulé}. Toute
 *     intersection ⇒ inclus, sans limite. Le plus sûr.
 *   Bloc 2 — SÉMANTIQUE titre-à-titre (à la suite). Pour les non-retenus,
 *     similarité cosinus entre embedding du titre candidat et embedding de
 *     l'intitulé. ≥ seuil ⇒ inclus, triés décroissant. < seuil ⇒ exclus.
 *
 * VOLUME PILOTÉ PAR LA PERTINENCE : pas de plafond. Liste vide = réponse valide.
 * La fraîcheur n'intervient qu'en départage léger. Server-only.
 */

import { embedText } from '@/lib/ai/embeddings';
import { runTitleVariantsSuggestion } from '@/lib/agents/server/title-variants-execute';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  listDistinctEmbeddingModels,
  listIndexedVivierTitles,
  listSkillEmbeddingsByCandidateIds,
  matchVivierAnchors,
  matchVivierTitles,
  type IndexedVivierTitle,
} from '@/lib/db/repos/vivier';
import {
  listContactedEmailsSince,
  listRejectedEmailsForCampaign,
  replacePreselection,
} from '@/lib/db/repos/vivier-preselection';
import { normalizeEmail } from '@/lib/vivier/candidates';
import { atomizeJobSkills } from '@/lib/vivier/job-skills';
import {
  computeSkillCoverage,
  type SkillVector,
} from '@/lib/vivier/skill-coverage';
import { pickBestAnchor } from '@/lib/vivier/anchor-semantic';
import {
  anchorLabel,
  anchorWeight,
  matchAnchors,
} from '@/lib/vivier/title-anchors';
import { splitTitleIntoBlocks } from '@/lib/vivier/title-splitting';
import type { FDPInProgress } from '@/types/field-collection';
import { DEFAULT_VIVIER_CONFIG, type VivierConfig } from '@/types/vivier-settings';
import type {
  HardFilterMatch,
  PreselectionMatchKind,
  ShortlistEntry,
} from '@/types/vivier-preselection';

// ── Constantes (fraîcheur en départage léger) ────────────────────────────────
export const FRESHNESS_FULL_MONTHS = 12;
export const FRESHNESS_DECAY_PER_MONTH = 0.05;
export const FRESHNESS_FLOOR = 0.5;
/** Fraîcheur en DÉPARTAGE (jamais d'inversion d'un écart de similarité réel). */
const FRESHNESS_TIEBREAK_WEIGHT = 0.05;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type PreselectionErrorCode =
  | 'campaign_not_found'
  | 'vivier_not_enabled'
  | 'no_job_title'
  | 'embedding_model_mismatch';

export class PreselectionError extends Error {
  constructor(
    public readonly code: PreselectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PreselectionError';
  }
}

// ── Helpers purs (exportés pour test) ────────────────────────────────────────

/**
 * Normalise un terme de titre pour le matching déterministe : trim, minuscules,
 * SUPPRESSION DES ACCENTS (comparaison insensible casse + accents), espaces
 * multiples réduits.
 */
export function normalizeTitleTerm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Ensemble normalisé des termes côté campagne : BLOCS de l'intitulé (titres
 * composés) + variantes. `titleForms` = `splitTitleIntoBlocks(intitulé)`.
 */
export function campaignTitleTermSet(
  titleForms: string[],
  variants: string[],
): Set<string> {
  const set = new Set<string>();
  for (const t of [...titleForms, ...variants]) {
    const n = normalizeTitleTerm(t);
    if (n) set.add(n);
  }
  return set;
}

/**
 * Premier terme candidat (titre ou variante) dont la forme normalisée appartient
 * à l'ensemble campagne — l'explication du bloc 1. null si aucun.
 */
export function firstDeterministicMatch(
  candidateTitle: string | null,
  candidateVariants: string[],
  campaignSet: Set<string>,
): string | null {
  for (const term of [candidateTitle ?? '', ...candidateVariants]) {
    const t = term.trim();
    if (t && campaignSet.has(normalizeTitleTerm(t))) return t;
  }
  return null;
}

/**
 * Facteur de fraîcheur 0..1. 1 jusqu'à `FRESHNESS_FULL_MONTHS`, puis dégressif
 * jusqu'au plancher. `now` injecté (pureté). Date illisible ⇒ pas de pénalité.
 */
export function freshnessFactor(updatedAt: string, now: number): number {
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) return 1;
  const ageMonths = Math.max(0, (now - updated) / MS_PER_MONTH);
  if (ageMonths <= FRESHNESS_FULL_MONTHS) return 1;
  const decayed =
    1 - (ageMonths - FRESHNESS_FULL_MONTHS) * FRESHNESS_DECAY_PER_MONTH;
  return Math.max(FRESHNESS_FLOOR, decayed);
}

/** Intitulé de poste d'une campagne (FDP), vide si non renseigné. */
function jobTitleOf(fdp: FDPInProgress): string {
  const v = fdp.fields.job_title?.value;
  return typeof v === 'string' ? v.trim() : '';
}

function makeEntry(
  c: IndexedVivierTitle,
  matchKind: PreselectionMatchKind,
  matchTerm: string | null,
  similarity: number,
  now: number,
): ShortlistEntry {
  const freshness = freshnessFactor(c.updatedAt, now);
  return {
    candidateId: c.id,
    nom: c.nom,
    email: c.email,
    matchKind,
    matchTerm,
    matchAnchorLabel: null,
    similarity,
    // Couverture compétences posée par le post-pass set-to-set (0 par défaut).
    skillCoverage: 0,
    skillMatches: [],
    freshnessFactor: freshness,
    // Provisoire (titre seul) — recalculé par finalizeScores avec le poids skills.
    relevanceScore: similarity + FRESHNESS_TIEBREAK_WEIGHT * (freshness - 1),
    updatedAt: c.updatedAt,
    passedFilters: [] as HardFilterMatch[],
    rank: 0,
    state: 'identified',
    contactedAt: null,
    rejectedAt: null,
    decidedBy: null,
    appliedAt: null,
  };
}

/** Score final = titre (70%) + compétences (30%) + nudge fraîcheur borné. */
function finalScore(
  similarity: number,
  coverage: number,
  freshness: number,
  cfg: VivierConfig,
): number {
  return (
    cfg.titleWeight * similarity +
    cfg.skillWeight * coverage +
    FRESHNESS_TIEBREAK_WEIGHT * (freshness - 1)
  );
}

/**
 * Post-pass set-to-set : pose `skillCoverage` + `skillMatches` sur chaque entrée
 * (couverture des compétences attendues par celles du candidat), recalcule le
 * score final (titre + compétences) puis trie GLOBALEMENT décroissant et range.
 * Les compétences RÉORDONNENT les qualifiés — elles ne qualifient personne (la
 * porte d'entrée reste le titre). `jobSkillVectors` vide ⇒ couverture 0 partout
 * (ordre = titre seul, inchangé).
 */
function finalizeScores(
  entries: ShortlistEntry[],
  jobSkillVectors: SkillVector[],
  candidateSkills: Map<string, SkillVector[]>,
  cfg: VivierConfig,
): ShortlistEntry[] {
  for (const e of entries) {
    const cov = computeSkillCoverage({
      jobSkills: jobSkillVectors,
      candidateSkills: candidateSkills.get(e.candidateId) ?? [],
      perSkillFloor: cfg.skillPerSkillFloor,
    });
    e.skillCoverage = cov.coverage;
    e.skillMatches = cov.matches.map((m) => ({
      jobSkill: m.jobSkill,
      candidateSkill: m.candidateSkill,
      covered: m.covered,
    }));
    e.relevanceScore = finalScore(e.similarity, cov.coverage, e.freshnessFactor, cfg);
  }
  entries.sort((a, b) => b.relevanceScore - a.relevanceScore);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });
  return entries;
}

/**
 * Embeddings des compétences ATTENDUES de la fiche (atomisées depuis key_skills),
 * calculés à la volée (V1 ; cache par campagne = réserve V2). Best-effort : un
 * échec d'embed ⇒ liste vide ⇒ couverture 0 (dégradation vers le titre seul).
 * L'espace d'embeddings est déjà vérifié == requête titre (garde-fou amont).
 */
async function embedJobSkills(fdp: FDPInProgress): Promise<SkillVector[]> {
  const terms = atomizeJobSkills(fdp.fields.key_skills?.value);
  if (terms.length === 0) return [];
  try {
    return await Promise.all(
      terms.map(async (term) => ({ term, vector: (await embedText(term)).vector })),
    );
  } catch (err) {
    console.error('[vivier] embed compétences poste échoué', err);
    return [];
  }
}

/**
 * Bloc 2 SÉMANTIQUE MULTI-ANCRES : cosinus par ancre (RPC) puis meilleure ancre
 * décotée (`pickBestAnchor`, porte sur le brut ≥ seuil). Repli déclaré
 * (`matchVivierTitles`, depth 0) pour les candidats sans ancre-embedding (pas
 * encore réindexés) — zéro régression. Mutualisé fiche + recherche libre.
 */
async function semanticAnchorEntries(
  cands: IndexedVivierTitle[],
  vector: number[],
  threshold: number,
  weights: number[],
  now: number,
): Promise<{ entries: ShortlistEntry[]; belowThreshold: number }> {
  const ids = cands.map((c) => c.id);
  const anchorSims = await matchVivierAnchors(vector, ids);
  const missing = ids.filter((id) => !anchorSims.has(id));
  const declaredSims =
    missing.length > 0 ? await matchVivierTitles(vector, missing) : new Map<string, number>();

  let belowThreshold = 0;
  const entries: ShortlistEntry[] = [];
  for (const c of cands) {
    const perAnchor = anchorSims.get(c.id);
    let match: { similarity: number; depth: number } | null = null;
    if (perAnchor) {
      match = pickBestAnchor(perAnchor, weights, threshold);
    } else {
      const sim = declaredSims.get(c.id);
      if (sim !== undefined && sim >= threshold) match = { similarity: sim, depth: 0 };
    }
    if (!match) {
      // « Sous le seuil » seulement si un signal existait (ancre ou titre déclaré).
      if (perAnchor || declaredSims.has(c.id)) belowThreshold++;
      continue;
    }
    const e = makeEntry(c, 'title_semantic', null, match.similarity, now);
    e.matchAnchorLabel = anchorLabel(match.depth);
    entries.push(e);
  }
  return { entries, belowThreshold };
}

// ── Orchestrateur ────────────────────────────────────────────────────────────

export type PreselectionOptions = {
  /** Horloge injectée (pureté de la fraîcheur en test). Défaut Date.now(). */
  now?: number;
  /** Recherche libre : texte embeddé en requête (bloc 2 sémantique seul). Éphémère. */
  freeText?: string;
};

export type PreselectionMeta = {
  /** Dossiers indexés évalués. */
  indexedCount: number;
  /** Retenus au bloc 1 (déterministe). */
  deterministicCount: number;
  /** Retenus au bloc 2 (sémantique titre). */
  semanticCount: number;
  /** Écartés faute de similarité suffisante (bloc 2 sous le seuil). */
  belowThreshold: number;
};

export type PreselectionResult = {
  entries: ShortlistEntry[];
  meta: PreselectionMeta;
};

/** Emails déjà candidats sur la campagne (rapprochement exact, §6.3). */
async function loadExcludedEmails(campaignId: string): Promise<Set<string>> {
  const analyses = await listCandidateAnalyses({ campaignId });
  const set = new Set<string>();
  for (const a of analyses) {
    if (a.candidateEmail) set.add(normalizeEmail(a.candidateEmail));
  }
  return set;
}

/**
 * Cascade titre. Renvoie la short-list ordonnée (NON persistée) + méta. Lève
 * `PreselectionError` (campagne, source, intitulé manquant, espace d'embeddings
 * incohérent).
 */
export async function runVivierPreselection(
  campaignId: string,
  opts: PreselectionOptions = {},
): Promise<PreselectionResult> {
  const now = opts.now ?? Date.now();

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new PreselectionError('campaign_not_found', 'Campagne introuvable.');
  }
  if (!campaign.sources.includes('vivier')) {
    throw new PreselectionError(
      'vivier_not_enabled',
      'La source Vivier n’est pas activée pour cette campagne.',
    );
  }
  const jobTitle = jobTitleOf(campaign.fdp);
  if (!jobTitle) {
    throw new PreselectionError(
      'no_job_title',
      'L’intitulé du poste (fiche) est requis pour la présélection sur le titre.',
    );
  }

  // Embedding de requête (intitulé, ou texte libre) + garde-fou d'espace.
  const queryText = opts.freeText?.trim() || jobTitle;
  const { vector, provider, model } = await embedText(queryText);
  const queryKey = `${provider}|${model}`;
  const storedKeys = await listDistinctEmbeddingModels();
  if (storedKeys.length > 0 && !(storedKeys.length === 1 && storedKeys[0] === queryKey)) {
    throw new PreselectionError(
      'embedding_model_mismatch',
      `Incohérence d'espace d'embeddings : la requête utilise « ${queryKey} » ` +
        `mais les titres sont indexés avec « ${storedKeys.join(', ')} ». ` +
        `Réindexez (npm run reindex:vivier) avec le bon modèle ET redémarrez le serveur.`,
    );
  }

  const candidates = await listIndexedVivierTitles();
  // Fusion avec les défauts : une config stockée avant le Chantier 4 n'a pas les
  // nouveaux champs (poids, seuil skills, séparateurs) → on les comble.
  const config: VivierConfig = {
    ...DEFAULT_VIVIER_CONFIG,
    ...(await getAppSettings())?.vivierConfig,
  };
  const threshold = config.similarityFloor;

  // Exclusions (§6/§7) appliquées aux deux blocs.
  const cooldownSince = new Date(now - config.cooldownDays * MS_PER_DAY).toISOString();
  const [appliedEmails, cooldownEmails, rejectedEmails] = await Promise.all([
    loadExcludedEmails(campaignId),
    listContactedEmailsSince(cooldownSince),
    listRejectedEmailsForCampaign(campaignId),
  ]);
  const excluded = new Set<string>([
    ...appliedEmails,
    ...cooldownEmails,
    ...rejectedEmails,
  ]);
  const isExcluded = (email: string) => excluded.has(normalizeEmail(email));
  const eligible = candidates.filter((c) => !isExcluded(c.email));

  // RECHERCHE LIBRE : bloc 2 sémantique seul (pas de déterministe, pas de skills
  // — la requête libre n'a pas de fiche). Le tri reste piloté par le titre.
  if (opts.freeText?.trim()) {
    const { entries, belowThreshold: below } = await semanticAnchorEntries(
      eligible,
      vector,
      threshold,
      config.titleAnchorWeights,
      now,
    );
    finalizeScores(entries, [], new Map(), config);
    return {
      entries,
      meta: {
        indexedCount: candidates.length,
        deterministicCount: 0,
        semanticCount: entries.length,
        belowThreshold: below,
      },
    };
  }

  // Variantes ISO-RÔLE de l'intitulé (par bloc + complet), NON bloquant.
  const jobTitleForms = splitTitleIntoBlocks(jobTitle, config.titleSeparators);
  let jobVariants: string[] = [];
  try {
    jobVariants = (await runTitleVariantsSuggestion(jobTitleForms)).variants;
  } catch (err) {
    console.error('[vivier] variantes intitulé poste échouées', err);
  }
  const campaignSet = campaignTitleTermSet(jobTitleForms, jobVariants);

  // Bloc 1 — déterministe MULTI-ANCRES : titre déclaré + 2 derniers postes.
  // On retient l'ancre la plus récente qui matche (décote d'ancienneté au score)
  // pour repêcher les titres déclarés bruités via un poste passé propre.
  const bloc1: ShortlistEntry[] = [];
  const bloc1Ids = new Set<string>();
  for (const c of eligible) {
    let match: { term: string; depth: number } | null = null;
    if (c.titleAnchors.length > 0) {
      const m = matchAnchors(c.titleAnchors, campaignSet, normalizeTitleTerm);
      if (m) match = { term: m.term, depth: m.depth };
    } else {
      // Repli (dossier pas encore réindexé) : titre déclaré + variantes, depth 0.
      const candTerms = [
        ...splitTitleIntoBlocks(c.title ?? '', config.titleSeparators),
        ...c.titleVariants,
      ];
      const term = firstDeterministicMatch(null, candTerms, campaignSet);
      if (term) match = { term, depth: 0 };
    }
    if (match) {
      const weight = anchorWeight(match.depth, config.titleAnchorWeights);
      const entry = makeEntry(c, 'title_exact', match.term, weight, now);
      entry.matchAnchorLabel = anchorLabel(match.depth);
      bloc1.push(entry);
      bloc1Ids.add(c.id);
    }
  }

  // Bloc 2 — sémantique MULTI-ANCRES, sur les non-retenus au bloc 1 : le meilleur
  // anchor (déclaré OU poste) décide, ce qui repêche un titre déclaré bruité via
  // un poste propre. Repli déclaré pour les dossiers pas encore réindexés.
  const remaining = eligible.filter((c) => !bloc1Ids.has(c.id));
  const { entries: bloc2, belowThreshold } = await semanticAnchorEntries(
    remaining,
    vector,
    threshold,
    config.titleAnchorWeights,
    now,
  );

  // Qualifiés (porte d'entrée = titre). Les COMPÉTENCES réordonnent, ne
  // qualifient personne : post-pass set-to-set puis tri GLOBAL par score final.
  const merged = [...bloc1, ...bloc2];
  // BEST-EFFORT : le scoring compétences est un APPOINT. Un échec d'infra
  // (table compétences, embed, cache) ne doit JAMAIS faire échouer la cascade
  // titre — sinon rien ne se persiste et la worklist reste vide. Repli titre seul.
  let jobSkillVectors: SkillVector[] = [];
  let candidateSkills = new Map<string, SkillVector[]>();
  try {
    jobSkillVectors = await embedJobSkills(campaign.fdp);
    candidateSkills = await listSkillEmbeddingsByCandidateIds(
      merged.map((e) => e.candidateId),
    );
  } catch (err) {
    console.error('[vivier] scoring compétences indisponible — repli titre seul', err);
  }
  finalizeScores(merged, jobSkillVectors, candidateSkills, config);

  return {
    entries: merged,
    meta: {
      indexedCount: candidates.length,
      deterministicCount: bloc1.length,
      semanticCount: bloc2.length,
      belowThreshold,
    },
  };
}

/**
 * Exécute la présélection (intitulé) et la persiste (idempotent, préserve les
 * décisions V3). Renvoie short-list + méta. La recherche libre passe par
 * `runVivierPreselection` seul (éphémère).
 */
export async function runAndPersistPreselection(
  campaignId: string,
  opts: Omit<PreselectionOptions, 'freeText'> = {},
): Promise<PreselectionResult> {
  const result = await runVivierPreselection(campaignId, opts);
  await replacePreselection(campaignId, result.entries);
  return result;
}
