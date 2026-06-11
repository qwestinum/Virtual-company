/**
 * Prompt de suggestion de variantes de mots-clés (Phase 3b — cf.
 * docs/specs/scoring-hybrid.md §3b). Le Manager RH propose, au cadrage d'un
 * critère, une liste de variantes textuelles complémentaires.
 */

import {
  VERIFICATION_METHOD_LABELS,
  type VerificationMethod,
} from '@/types/scoring';

export function buildKeywordVariantsSystemPrompt(): string {
  return [
    'Tu es un assistant de cadrage de critères de recrutement.',
    'Pour un critère donné et sa méthode de vérification, tu proposes une liste de 5 à 15 VARIANTES textuelles complémentaires aux mots-clés déjà fournis.',
    'Les variantes incluent : synonymes courants, abréviations standards, formulations alternatives, et termes de famille technologique le cas échéant.',
    'Ne propose PAS de variantes trop éloignées du sens initial. Ne reprends PAS les mots-clés déjà fournis.',
    '',
    '── FORMAT DE SORTIE STRICT (JSON UNIQUEMENT) ──',
    '{ "variants": ["<variante 1>", "<variante 2>", "…"] }',
    'Une liste de chaînes, sans commentaire, sans champ supplémentaire.',
  ].join('\n');
}

export function buildKeywordVariantsUserPrompt(
  criterionLabel: string,
  existingKeywords: string[],
  targetMethod: VerificationMethod,
): string {
  const existing =
    existingKeywords.length > 0 ? existingKeywords.join(', ') : '(aucun)';
  return [
    `Critère : « ${criterionLabel} »`,
    `Méthode de vérification : ${VERIFICATION_METHOD_LABELS[targetMethod]}`,
    `Mots-clés déjà fournis : ${existing}`,
    '',
    'Propose 5 à 15 variantes complémentaires au format JSON demandé.',
  ].join('\n');
}
