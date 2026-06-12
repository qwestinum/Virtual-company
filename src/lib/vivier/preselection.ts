/**
 * Traitement de présélection vivier (Session V2, docs/specs/vivier.md §4).
 *
 * Cascade déterministe en quatre étapes, déclenchée à l'activation d'une
 * campagne dont la source Vivier est cochée (et relançable manuellement) :
 *
 *   1. FILTRES DURS — les critères de criticité dure (redhibitoire/obligatoire)
 *      QUI portent des mots-clés exploitables sont appliqués comme filtres sur
 *      les entités structurées du dossier. Mapping : pas de champ « type » de
 *      critère ⇒ on cherche la présence d'au moins un mot-clé du critère dans le
 *      POOL des entités (technologies ∪ certifications ∪ diplômes ∪ langues),
 *      par frontière de mot (réutilise `findMatchedKeywords`). Un critère dur
 *      SANS mots-clés (méthode `llm_with_quote`) est NON MAPPABLE : ignoré ici,
 *      évalué au scoring réel si le candidat postule. Un candidat survit ssi il
 *      passe TOUS les filtres durs mappables.
 *
 *   2. TRI SÉMANTIQUE — embedding de requête construit depuis la fiche (intitulé,
 *      missions, compétences, libellés des critères triés par poids) ; similarité
 *      cosinus (RPC pgvector) contre les survivants ; classement décroissant.
 *
 *   3. MODULATION FRAÎCHEUR — pertinence pondérée par l'ancienneté de la dernière
 *      mise à jour du dossier (dégressif au-delà de 12 mois ; cf. constantes).
 *
 *   4. EXCLUSIONS — pending/failed (déjà exclus : seuls les `indexed` entrent),
 *      candidats déjà candidats sur la campagne (rapprochement par email), et
 *      cooldown (point d'extension V3, vide en V2).
 *
 * Sortie : short-list ordonnée, plafonnée (`SHORTLIST_CAP`), chaque entrée
 * portant son explication de pertinence (similarité, filtres durs satisfaits,
 * fraîcheur). Server-only.
 */

import { embedText } from '@/lib/ai/embeddings';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  listIndexedVivierEntities,
  matchVivierCandidates,
} from '@/lib/db/repos/vivier';
import {
  listContactedEmailsSince,
  listRejectedEmailsForCampaign,
  replacePreselection,
} from '@/lib/db/repos/vivier-preselection';
import { findMatchedKeywords } from '@/lib/scoring/keyword-matcher';
import { normalizeEmail } from '@/lib/vivier/candidates';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';
import { criterionBehavior, type ScoringSheet } from '@/types/scoring';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';
import type { VivierEntities } from '@/types/vivier';
import type {
  HardFilter,
  HardFilterMatch,
  ShortlistEntry,
} from '@/types/vivier-preselection';

// ── Constantes documentées (paramétrables en V3) ────────────────────────────
/** Au-delà de ce seuil d'ancienneté (mois), la fraîcheur devient dégressive. */
export const FRESHNESS_FULL_MONTHS = 12;
/** Décote de fraîcheur par mois au-delà du seuil. */
export const FRESHNESS_DECAY_PER_MONTH = 0.05;
/** Plancher de fraîcheur : un vieux dossier n'est jamais totalement annulé. */
export const FRESHNESS_FLOOR = 0.5;
/** Plafond de la short-list (défaut spec §4.2 ; constante en V2). */
export const SHORTLIST_CAP = 50;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Champs FDP injectés dans le texte de requête sémantique (ordre signifiant). */
const QUERY_FIELDS: FieldKey[] = [
  'job_title',
  'main_missions',
  'key_skills',
  'seniority',
  'location',
];

/** Codes d'échec métier de la présélection (mappés en HTTP côté route). */
export type PreselectionErrorCode =
  | 'campaign_not_found'
  | 'vivier_not_enabled'
  | 'no_validated_sheet';

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
 * Sélectionne les filtres durs MAPPABLES d'une fiche : critères de criticité
 * dure (HARD_KNOCKOUT/HARD_CAP) portant au moins un mot-clé non vide. Les
 * critères durs sans mots-clés sont ignorés (non mappables sur les entités).
 */
export function selectHardFilters(sheet: ScoringSheet): HardFilter[] {
  const filters: HardFilter[] = [];
  for (const c of sheet.criteria) {
    const behavior = criterionBehavior(c.level);
    if (behavior !== 'HARD_KNOCKOUT' && behavior !== 'HARD_CAP') continue;
    const keywords = (c.keywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (keywords.length === 0) continue;
    filters.push({ criterionId: c.id, label: c.label, keywords });
  }
  return filters;
}

/** Texte poolé des entités « dures » d'un dossier (base du matching mots-clés). */
export function pooledEntityText(entities: VivierEntities): string {
  return [
    ...entities.technologies,
    ...entities.certifications,
    ...entities.diplomes,
    ...entities.langues,
  ].join('\n');
}

/**
 * Un candidat passe-t-il TOUS les filtres durs ? Un seul filtre non satisfait
 * (aucun mot-clé trouvé dans le pool d'entités) ⇒ éliminé. Sans filtre dur
 * mappable, tout le monde passe.
 */
export function candidatePassesHardFilters(
  entities: VivierEntities,
  filters: HardFilter[],
): { passed: boolean; matches: HardFilterMatch[] } {
  if (filters.length === 0) return { passed: true, matches: [] };
  const text = pooledEntityText(entities);
  const matches: HardFilterMatch[] = [];
  for (const f of filters) {
    const { matched } = findMatchedKeywords(text, f.keywords);
    if (matched.length === 0) return { passed: false, matches: [] };
    matches.push({
      criterionId: f.criterionId,
      label: f.label,
      matchedTerms: matched,
    });
  }
  return { passed: true, matches };
}

/** Valeur textuelle d'un champ FDP (string, ou liste jointe), sinon ''. */
function fieldText(fdp: FDPInProgress, key: FieldKey): string {
  const v = fdp.fields[key]?.value;
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string').join(', ');
  }
  return '';
}

/**
 * Construit le texte de requête sémantique depuis la fiche : champs FDP
 * signifiants + libellés des critères TRIÉS PAR POIDS décroissant (les critères
 * pondérés portent l'intention). Pas de répétition (artefact peu fiable pour un
 * embedding) — la pondération vit dans la présence des critères, pas leur
 * duplication. Pur.
 */
export function buildVivierQueryText(
  fdp: FDPInProgress,
  sheet: ScoringSheet,
): string {
  const parts: string[] = [];
  for (const key of QUERY_FIELDS) {
    const t = fieldText(fdp, key);
    if (t) parts.push(t);
  }
  const labels = [...sheet.criteria]
    .sort((a, b) => b.weight - a.weight)
    .map((c) => c.label);
  parts.push(...labels);
  return parts.join('\n').trim();
}

/**
 * Facteur de fraîcheur 0..1 d'un dossier. 1 jusqu'à `FRESHNESS_FULL_MONTHS`,
 * puis dégressif (`FRESHNESS_DECAY_PER_MONTH`/mois) jusqu'au plancher
 * `FRESHNESS_FLOOR`. `now` injecté (pureté). Date illisible ⇒ pas de pénalité.
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

// ── Orchestrateur ────────────────────────────────────────────────────────────

export type PreselectionOptions = {
  /** Horloge injectée (pureté de la fraîcheur en test). Défaut Date.now(). */
  now?: number;
  /**
   * Recherche libre : remplace le texte de requête fiche par ce texte (même
   * cascade, même format de short-list). La short-list issue d'une recherche
   * libre est ÉPHÉMÈRE (l'appelant ne la persiste pas).
   */
  freeText?: string;
};

/** Métadonnées de transparence d'un run de présélection (affichées au DRH). */
export type PreselectionMeta = {
  /** Dossiers indexés évalués (univers de départ). */
  indexedCount: number;
  /** Survivants des filtres durs (avant repli éventuel). */
  survivors: number;
  /** Dossiers écartés par les filtres durs. */
  eliminatedByHardFilters: number;
  /**
   * Repli sémantique : aucun dossier ne passait TOUS les filtres durs, on a
   * classé l'ensemble par similarité seule (signalé au DRH). Évite l'écran vide.
   */
  fallbackSemantic: boolean;
};

export type PreselectionResult = {
  entries: ShortlistEntry[];
  meta: PreselectionMeta;
};

/** Emails déjà candidats sur la campagne (rapprochement exact, §6.3 préparé). */
async function loadExcludedEmails(campaignId: string): Promise<Set<string>> {
  const analyses = await listCandidateAnalyses({ campaignId });
  const set = new Set<string>();
  for (const a of analyses) {
    if (a.candidateEmail) set.add(normalizeEmail(a.candidateEmail));
  }
  return set;
}

/**
 * Exécute la cascade de présélection et renvoie la short-list ordonnée (NON
 * persistée). Lève `PreselectionError` si la campagne est introuvable, la source
 * Vivier non cochée, ou la fiche non validée.
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
  const sheet = campaign.scoringSheet;
  if (!sheet || !sheet.isValidated) {
    throw new PreselectionError(
      'no_validated_sheet',
      'Aucune fiche de scoring validée — la présélection s’appuie dessus.',
    );
  }

  // Étape 1 — filtres durs sur entités.
  const hardFilters = selectHardFilters(sheet);
  const indexed = await listIndexedVivierEntities();
  const passing = indexed
    .map((cand) => ({
      cand,
      ...candidatePassesHardFilters(cand.entities, hardFilters),
    }))
    .filter((s) => s.passed);
  const eliminatedByHardFilters = indexed.length - passing.length;

  // REPLI SÉMANTIQUE : si des filtres durs ont tout écarté alors que le vivier
  // n'est pas vide, on ne laisse pas un écran vide — on classe l'ensemble des
  // indexés par similarité seule (sans filtre dur), et on le signale au DRH.
  const fallbackSemantic =
    passing.length === 0 && hardFilters.length > 0 && indexed.length > 0;
  const survivors = fallbackSemantic
    ? indexed.map((cand) => ({
        cand,
        passed: true,
        matches: [] as HardFilterMatch[],
      }))
    : passing;

  const meta: PreselectionMeta = {
    indexedCount: indexed.length,
    survivors: passing.length,
    eliminatedByHardFilters,
    fallbackSemantic,
  };

  if (survivors.length === 0) return { entries: [], meta };

  // Étape 2 — tri sémantique (fiche, ou requête libre si fournie).
  const queryText = opts.freeText?.trim()
    ? opts.freeText.trim()
    : buildVivierQueryText(campaign.fdp, sheet);
  if (!queryText) return { entries: [], meta };
  const { vector } = await embedText(queryText);
  const sims = await matchVivierCandidates(
    vector,
    survivors.map((s) => s.cand.id),
  );

  // Étape 4 — exclusions. Réglages vivier (cooldown, plafond) depuis les
  // settings (repli défauts). Trois exclusions combinées :
  //   - déjà candidat sur la campagne (rapprochement email) ;
  //   - cooldown GLOBAL : contacté il y a moins de `cooldownDays` (toutes
  //     campagnes) — échéance = contacted_at + cooldownDays ;
  //   - rejeté POUR cette campagne (éligible ailleurs).
  const settings = await getAppSettings();
  const config = settings?.vivierConfig ?? DEFAULT_VIVIER_CONFIG;
  const cooldownSince = new Date(
    now - config.cooldownDays * MS_PER_DAY,
  ).toISOString();
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

  // Étape 3 — modulation fraîcheur + assemblage.
  const scored: ShortlistEntry[] = [];
  for (const s of survivors) {
    const email = normalizeEmail(s.cand.email);
    if (excluded.has(email)) continue;
    const similarity = sims.get(s.cand.id);
    if (similarity === undefined) continue;
    const freshness = freshnessFactor(s.cand.updatedAt, now);
    scored.push({
      candidateId: s.cand.id,
      nom: s.cand.nom,
      email: s.cand.email,
      similarity,
      freshnessFactor: freshness,
      relevanceScore: similarity * freshness,
      updatedAt: s.cand.updatedAt,
      passedFilters: s.matches,
      rank: 0,
      state: 'identified',
      contactedAt: null,
      rejectedAt: null,
      decidedBy: null,
      appliedAt: null,
    });
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const capped = scored.slice(0, config.shortlistCap);
  capped.forEach((e, i) => {
    e.rank = i + 1;
  });
  return { entries: capped, meta };
}

/**
 * Exécute la présélection FICHE et la persiste (idempotent, préserve les
 * décisions V3). Renvoie la short-list. À utiliser pour l'activation et la
 * relance manuelle. La recherche libre passe par `runVivierPreselection` seul
 * (éphémère, non persistée).
 */
export async function runAndPersistPreselection(
  campaignId: string,
  opts: Omit<PreselectionOptions, 'freeText'> = {},
): Promise<PreselectionResult> {
  const result = await runVivierPreselection(campaignId, opts);
  await replacePreselection(campaignId, result.entries);
  return result;
}
