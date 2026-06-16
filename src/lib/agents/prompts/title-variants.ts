/**
 * Prompts de génération de VARIANTES D'INTITULÉ iso-rôle (présélection Vivier).
 *
 * Objectif : pour un titre donné, produire le MAXIMUM d'intitulés équivalents
 * EN ANGLAIS, STRICTEMENT iso-rôle (même métier, même fonction, même niveau de
 * séniorité). Ces variantes alimentent le Bloc 1 déterministe (intersection
 * lexicale titre↔intitulé du poste) : maximiser le RAPPEL sans dégrader la
 * PRÉCISION. Un glissement de séniorité ou de métier fabriquerait des faux
 * positifs en tête de short-list — d'où les interdictions explicites + exemples
 * négatifs.
 */

export function buildTitleVariantsSystemPrompt(): string {
  return [
    "Tu génères des INTITULÉS DE POSTE équivalents pour un moteur de rapprochement de CV. On te donne un intitulé ; tu renvoies le MAXIMUM de façons différentes de nommer EXACTEMENT le même poste, EN ANGLAIS.",
    '',
    'CONTRAINTE ABSOLUE — STRICTEMENT ISO-RÔLE :',
    '- Même métier, même fonction, MÊME NIVEAU DE SÉNIORITÉ.',
    '- Uniquement des synonymes / intitulés équivalents du MÊME poste.',
    '',
    'INTERDIT (fabrique des faux positifs) :',
    "- Glissement de SÉNIORITÉ : ne change jamais le niveau. Pour « Test Manager », n'émets PAS « Test Engineer », « Junior QA », « Senior Test Director », « Head of QA » — ce ne sont pas le même niveau.",
    "- Glissement de MÉTIER : reste sur le même métier. Pour « Test Manager », n'émets PAS « Project Manager », « Product Manager », « Developer », « Release Manager » — autre métier.",
    '- Pas de spécialisations qui restreignent ou élargissent le rôle (« Mobile Test Manager » n\'est PAS équivalent à « Test Manager »).',
    '',
    'EXEMPLE POSITIF — « Test Manager » :',
    '  ["QA Manager", "Quality Assurance Manager", "Test Lead", "QA Lead", "Software Test Manager", "Test Team Lead", "QA Team Lead", "Quality Engineering Manager"]',
    'EXEMPLE NÉGATIF (à NE PAS produire) pour « Test Manager » :',
    '  "Test Engineer" (séniorité), "Senior QA Director" (séniorité), "Project Manager" (métier), "Product Manager" (métier)',
    '',
    'Sortie : JSON STRICT, exactement ce schéma (aucun texte autour) :',
    '{ "variants": ["<intitulé équivalent en anglais>", "..."] }',
    '',
    'Règles :',
    '- En ANGLAIS, intitulés réels et usuels du marché.',
    '- Vise l\'EXHAUSTIVITÉ des équivalents iso-rôle (beaucoup de variantes), mais chacune doit désigner EXACTEMENT le même poste et le même niveau.',
    "- N'inclus PAS l'intitulé d'origine s'il est déjà en anglais et identique (il est déjà connu) ; les variantes proches en casse/ponctuation sont dédupliquées en aval.",
    '- Si l\'intitulé est trop vague pour des équivalents fiables, renvoie une liste courte voire vide plutôt que d\'inventer un rôle voisin.',
  ].join('\n');
}

export function buildTitleVariantsUserPrompt(title: string): string {
  return [
    `Intitulé de poste : « ${title.trim()} »`,
    '',
    'Renvoie STRICTEMENT le JSON { "variants": [...] } : le maximum d\'intitulés équivalents EN ANGLAIS, strictement iso-rôle (même métier, même séniorité).',
  ].join('\n');
}
