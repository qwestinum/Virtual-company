/**
 * Vérification déterministe par mots-clés (fiche de scoring hybride, Phase 1 —
 * cf. docs/specs/scoring-hybrid.md §5.2). PUR, sans I/O ni LLM.
 *
 * Matching : insensible à la casse, sensible aux DÉLIMITEURS DE MOTS (pour
 * éviter « JS » ∈ « jsdom »), tout en préservant les caractères spéciaux des
 * mots-clés (« C++ » cherche bien « C++ », « .NET » bien « .NET »). Pas de
 * stemming ni fuzzy en v1 (backlog).
 */

/** Résultat standardisé d'une vérification par mots-clés. */
export type VerdictResult = {
  verdict: 'satisfait' | 'non';
  /** Extrait du CV autour du 1er mot-clé trouvé, ou '' si non trouvé. */
  citation: string;
  /** Mot-clé (de la liste) qui a matché, ou null. */
  matchedKeyword: string | null;
};

/** Échappe les métacaractères regex d'un mot-clé (préserve « C++ », « .NET »). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construit la regex d'un mot-clé avec frontières de mot Unicode. Les bornes
 * ne « coupent » que des caractères de mot (lettres/chiffres/_), ce qui laisse
 * passer les délimiteurs (espace, ponctuation) et gère accents + symboles.
 */
function keywordRegex(keyword: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}_])`,
    'iu',
  );
}

/** Citation lisible : ~40 caractères de contexte de part et d'autre du match. */
function buildCitation(cvText: string, start: number, end: number): string {
  const ctxStart = Math.max(0, start - 40);
  const ctxEnd = Math.min(cvText.length, end + 40);
  let snippet = cvText.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();
  if (ctxStart > 0) snippet = `… ${snippet}`;
  if (ctxEnd < cvText.length) snippet = `${snippet} …`;
  return snippet;
}

/**
 * Recherche les mots-clés dans le CV ; retourne le verdict sur le PREMIER
 * mot-clé trouvé (ordre de la liste). Les mots-clés vides/blancs sont ignorés.
 */
export function verifyKeywordsExact(
  cvText: string,
  keywords: string[],
): VerdictResult {
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const match = keywordRegex(trimmed).exec(cvText);
    if (match) {
      return {
        verdict: 'satisfait',
        citation: buildCitation(cvText, match.index, match.index + match[0].length),
        matchedKeyword: trimmed,
      };
    }
  }
  return { verdict: 'non', citation: '', matchedKeyword: null };
}

/**
 * Variante « avec variantes » — mécanique IDENTIQUE en v1 : c'est la richesse
 * de la liste de mots-clés (synonymes, abréviations) qui fait la différence,
 * pas l'algorithme de recherche.
 */
export function verifyKeywordsWithVariants(
  cvText: string,
  keywords: string[],
): VerdictResult {
  return verifyKeywordsExact(cvText, keywords);
}

/**
 * TOUS les mots-clés présents dans le CV (pas seulement le premier), dans
 * l'ordre de la liste, + une citation autour du premier trouvé. Sert à
 * renseigner `matchedKeywords` (affichage Phase 4) et le contexte hybride.
 */
export function findMatchedKeywords(
  cvText: string,
  keywords: string[],
): { matched: string[]; citation: string } {
  const matched: string[] = [];
  let citation = '';
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const m = keywordRegex(trimmed).exec(cvText);
    if (m) {
      matched.push(trimmed);
      if (citation === '') {
        citation = buildCitation(cvText, m.index, m.index + m[0].length);
      }
    }
  }
  return { matched, citation };
}

/**
 * Étape 1 de la méthode hybride (cf. scoring-hybrid.md §3a) : recherche des
 * mots-clés GARDIENS. Retourne la liste trouvée (vide → verdict `non` direct,
 * sans LLM) et une citation. `found` non vide ⇒ le critère rejoint le batch
 * LLM avec contexte « nécessaires mais pas suffisants ».
 */
export function matchKeywordsForHybrid(
  cvText: string,
  keywords: string[],
): { found: string[]; citation: string } {
  const { matched, citation } = findMatchedKeywords(cvText, keywords);
  return { found: matched, citation };
}
