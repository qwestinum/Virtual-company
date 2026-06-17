/**
 * Pré-remplissage d'une campagne à partir d'un document (appel d'offres ou
 * notes de réunion). Couche COMMUNE aux deux chemins de création — formulaire
 * (onglet Campagne) et chat Manager RH. Le document PRÉ-REMPLIT un brouillon ;
 * il ne CRÉE rien. Rien n'est persisté tant que l'humain n'a pas validé.
 *
 * Deux catégories de champs (cf. brief « Process First ») :
 *   A) FACTUELS / descriptifs — extraction directe. `suggere = false` :
 *      relus & corrigés librement, jamais bloquants.
 *   B) PONDÉRATIONS SUGGÉRÉES — jugement du LLM sur ce que le document met en
 *      avant. `suggere = true` à l'extraction : NON acquises tant que l'humain
 *      ne les a pas TRAITÉES (confirmer → suggere:false, ou rejeter → retrait).
 *      Tant qu'il en reste, le LANCEMENT est bloqué
 *      (cf. `countUntreatedSuggestions` dans `@/types/scoring`).
 *
 * HORS PÉRIMÈTRE ABSOLU : seuils de campagne et flags éliminatoires ne sont
 * JAMAIS extraits ni suggérés (leviers trop violents) — saisie 100% humaine.
 *
 * Le LLM n'invente JAMAIS : champ non trouvé → `value: null`. `extraitSource`
 * est le passage exact qui justifie la valeur (traçabilité — capté
 * systématiquement, affiché conditionnellement).
 */

import { z } from 'zod';

import { buildCriterion, type ScoringCriterion } from '@/types/scoring';
import {
  buildEmptyFDP,
  ContractTypeSchema,
  type FDPInProgress,
  type FieldKey,
  type FieldStatus,
  SenioritySchema,
} from '@/types/field-collection';

/** Champ factuel textuel extrait : valeur (ou null) + extrait source (ou null). */
export const PrefillTextFieldSchema = z.object({
  value: z.string().nullable(),
  extraitSource: z.string().nullable(),
});
export type PrefillTextField = z.infer<typeof PrefillTextFieldSchema>;

/** Champ factuel liste (missions / compétences) : items (ou null) + source. */
export const PrefillListFieldSchema = z.object({
  value: z.array(z.string()).nullable(),
  extraitSource: z.string().nullable(),
});
export type PrefillListField = z.infer<typeof PrefillListFieldSchema>;

/**
 * Niveaux qu'une suggestion IA peut porter. RESTREINT aux niveaux NON
 * éliminatoires (comportement SOFT_WEIGHTED). Les niveaux `redhibitoire`
 * (knockout) et `obligatoire` (cap) sont des FLAGS ÉLIMINATOIRES — hors
 * périmètre d'extraction/suggestion, saisie 100% humaine. Si l'humain veut
 * hisser un critère suggéré au rang éliminatoire, il le fait après coup à la
 * main. Garde-fou de cohérence avec `CRITICITY_TO_BEHAVIOR` : cf. test
 * `campaign-prefill` (toute dérive de la table fait échouer le test).
 */
export const SUGGESTABLE_LEVELS = [
  'critique',
  'tres_important',
  'important',
  'souhaitable',
] as const;
export const SuggestableLevelSchema = z.enum(SUGGESTABLE_LEVELS);
export type SuggestableLevel = z.infer<typeof SuggestableLevelSchema>;

/**
 * Pondération suggérée (catégorie B). Le LLM propose un `level` de criticité
 * pour un critère qu'il a relevé. Jamais de seuil ni de flag éliminatoire ici.
 * `conflit` : signalé quand des notes se contredisent (ex. « 45K… non 50 ») —
 * on retient la dernière mention et on la marque comme à vérifier.
 */
export const SuggestedCriterionSchema = z.object({
  label: z.string().min(1),
  level: SuggestableLevelSchema,
  extraitSource: z.string().nullable(),
  conflit: z.string().nullable().optional(),
});
export type SuggestedCriterion = z.infer<typeof SuggestedCriterionSchema>;

/**
 * Objet de pré-remplissage — sortie structurée de l'extracteur, IDENTIQUE pour
 * les deux chemins (même structure, mêmes flags). Validé par `chatCompleteJson`.
 */
export const CampaignPrefillSchema = z.object({
  jobTitle: PrefillTextFieldSchema,
  contractType: PrefillTextFieldSchema,
  location: PrefillTextFieldSchema,
  salaryRange: PrefillTextFieldSchema,
  seniority: PrefillTextFieldSchema,
  startDate: PrefillTextFieldSchema,
  mainMissions: PrefillListFieldSchema,
  keySkills: PrefillListFieldSchema,
  suggestedCriteria: z.array(SuggestedCriterionSchema),
});
export type CampaignPrefill = z.infer<typeof CampaignPrefillSchema>;

// ───────────────────────────────────────────────────────────────────────────
// Normalisation des champs à valeurs contraintes (séniorité / contrat). Le LLM
// peut écrire « temps plein », « CDI 39h », « expérimenté »… On ramène vers les
// options EXACTES des selects FDP (sinon le select afficherait un blanc tout en
// paraissant « rempli »). Aucun match confiant → `null` (champ laissé vide).
// PUR & testé.
// ───────────────────────────────────────────────────────────────────────────

export function normalizeSeniority(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return null;
  if (/(junior|d[ée]butant|jr\b)/.test(v)) return 'junior';
  if (/(senior|sr\b|exp[ée]riment|expert|lead|principal)/.test(v)) {
    return 'senior';
  }
  if (/(confirm|interm[ée]diaire|mid\b)/.test(v)) return 'confirmé';
  // Match exact d'une option (insensible à la casse) en dernier recours.
  const exact = SenioritySchema.options.find((o) => o.toLowerCase() === v);
  return exact ?? null;
}

export function normalizeContractType(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return null;
  if (/\bcdi\b/.test(v)) return 'CDI';
  if (/\bcdd\b/.test(v)) return 'CDD';
  if (/(freelance|ind[ée]pendant|portage|prestation)/.test(v)) {
    return 'freelance';
  }
  if (/(stage|stagiaire|internship)/.test(v)) return 'stage';
  const exact = ContractTypeSchema.options.find((o) => o.toLowerCase() === v);
  return exact ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Mappings purs prefill → état de campagne (partagés par les deux chemins).
// ───────────────────────────────────────────────────────────────────────────

function filledField(key: FieldKey, label: string, value: unknown): FieldStatus {
  return { key, label, status: 'filled', value, required: true };
}

/** Valeur textuelle non vide, sinon undefined. */
function textOrUndef(field: PrefillTextField): string | undefined {
  const v = field.value?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Liste non vide (items trimés, vides retirés), sinon undefined. */
function listOrUndef(field: PrefillListField): string[] | undefined {
  if (!field.value) return undefined;
  const items = field.value.map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Construit un `FDPInProgress` à partir des champs FACTUELS du prefill. Part
 * d'une FDP vide puis remplit les champs présents (status 'filled'). Les champs
 * absents restent 'empty'. Ne valide rien (isComplete/isValidated calculés en
 * aval comme pour une saisie manuelle). `seniority`/`contract_type` normalisés
 * vers les options exactes des selects.
 */
export function prefillToFDP(
  prefill: CampaignPrefill,
  campaignId: string,
): FDPInProgress {
  const fdp = buildEmptyFDP(campaignId);
  const set = (key: FieldKey, value: unknown) => {
    if (value === undefined) return;
    fdp.fields[key] = filledField(key, fdp.fields[key].label, value);
  };

  set('job_title', textOrUndef(prefill.jobTitle));
  set('location', textOrUndef(prefill.location));
  set('salary_range', textOrUndef(prefill.salaryRange));
  set('start_date', textOrUndef(prefill.startDate));
  set('main_missions', listOrUndef(prefill.mainMissions));
  set('key_skills', listOrUndef(prefill.keySkills));

  const seniority = normalizeSeniority(prefill.seniority.value);
  if (seniority) set('seniority', seniority);
  const contract = normalizeContractType(prefill.contractType.value);
  if (contract) set('contract_type', contract);

  return fdp;
}

/**
 * Construit les critères de scoring SUGGÉRÉS (suggere: true) à partir du
 * prefill. Le poids dérive du niveau (DEFAULT_WEIGHTS) — l'humain l'ajuste
 * ensuite. Ids déterministes par index (testabilité, pas de Math.random).
 */
export function prefillToSuggestedCriteria(
  prefill: CampaignPrefill,
): ScoringCriterion[] {
  return prefill.suggestedCriteria.map((c, i) =>
    buildCriterion({
      id: `sugg-${i + 1}`,
      label: c.label,
      level: c.level,
      suggere: true,
    }),
  );
}

/**
 * Index des extraits sources des champs FACTUELS, par `FieldKey`. Capté
 * systématiquement (V1), affiché conditionnellement (icône info / citation
 * chat). Sert aussi de payload persisté (`campaigns.prefill_extraction`) pour
 * éviter toute réextraction en V2.
 */
export function prefillSourceByField(
  prefill: CampaignPrefill,
): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  const put = (key: FieldKey, src: string | null) => {
    if (src && src.trim().length > 0) out[key] = src.trim();
  };
  put('job_title', prefill.jobTitle.extraitSource);
  put('contract_type', prefill.contractType.extraitSource);
  put('location', prefill.location.extraitSource);
  put('salary_range', prefill.salaryRange.extraitSource);
  put('seniority', prefill.seniority.extraitSource);
  put('start_date', prefill.startDate.extraitSource);
  put('main_missions', prefill.mainMissions.extraitSource);
  put('key_skills', prefill.keySkills.extraitSource);
  return out;
}
