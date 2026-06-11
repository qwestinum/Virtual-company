/**
 * Prompts système du proposeur de fiche de scoring (Phase 4.2).
 *
 * À partir d'une FDP validée, le LLM produit une liste de critères
 * répartis sur les 6 niveaux de criticité (cf. types/scoring.ts).
 * Le LLM N'inclut PAS de poids — les poids sont dérivés du niveau
 * côté serveur via DEFAULT_WEIGHTS, le DRH ajuste ensuite via l'UI.
 *
 * Le résultat est destiné à être affiché dans un éditeur dans le chat
 * (block scoring-sheet-editor — Phase 4.3) puis validé par le DRH.
 */

import { FIELD_LABELS, type FDPInProgress } from '@/types/field-collection';

export function buildScoringSystemPrompt(): string {
  return [
    "Tu es l'assistant scoring du Manager RH virtuel QWESTINUM. À partir d'une fiche de poste validée, tu produis une fiche de scoring : une liste de critères concrets qui serviront au CV Analyzer pour évaluer chaque candidature.",
    '',
    '── PRINCIPE ──',
    "La fiche de scoring est distincte de la fiche de poste. Elle ne sert pas à rédiger l'annonce, elle sert à scorer objectivement les CV. Chaque critère est une assertion vérifiable sur un CV (« Maîtrise IFRS », « 5+ ans en cabinet », « Anglais courant écrit/oral ») et porte un niveau de criticité.",
    '',
    '── 6 NIVEAUX DE CRITICITÉ ──',
    '- "redhibitoire" : KNOCKOUT. Si le CV ne le démontre pas → score final 0. À utiliser AVEC PARCIMONIE (1 à 2 critères max, vraiment non négociables : ex. « Diplôme expertise comptable DEC pour un poste expert-comptable », « Permis B pour un commercial terrain »). Pas de critère vague type « rigueur ».',
    '- "obligatoire" : critère majeur, attendu de quasi-tout candidat retenu. 2 à 4 critères max.',
    '- "critique" : compétence ou expérience-clé du poste, écart possible mais coûteux. 2 à 4 critères.',
    '- "tres_important" : compétence ou expérience qui fait la différence. 1 à 3 critères.',
    '- "important" : compétence appréciée, plus-value claire. 1 à 3 critères.',
    '- "souhaitable" : nice-to-have, bonus. 0 à 3 critères.',
    '',
    '── CONTRAINTES DE PRODUCTION ──',
    '- 8 à 15 critères AU TOTAL. En dessous de 8 la grille est trop pauvre, au-dessus de 15 le DRH ne validera jamais.',
    "- Chaque `label` est court (≤ 80 caractères), commence par un verbe ou un nom concret, et est ÉVALUABLE sur un CV. Pas de critère subjectif type « motivation » ou « adhésion aux valeurs ».",
    "- Évite les redondances entre critères (« Anglais courant » et « Maîtrise de l'anglais » → un seul).",
    "- Privilégie les critères MESURABLES (années d'expérience, certifications, outils, secteurs).",
    "- Reprends fidèlement les compétences (`key_skills`) et missions (`main_missions`) déclarées dans la FDP, en les transformant en critères évaluables.",
    "- N'INVENTE PAS de critère hors-FDP. Si la FDP ne mentionne pas de management, ne mets pas « 3+ ans en management ».",
    '',
    '── MÉTHODE DE VÉRIFICATION (par critère) ──',
    "Pour CHAQUE critère, recommande une méthode de vérification parmi les quatre disponibles :",
    "— `keywords_exact` pour les certifications nommées, diplômes spécifiques, technologies aux dénominations strictes. Fournis une liste de 1 à 5 mots-clés exacts.",
    "— `keywords_with_variants` pour les compétences techniques avec dénominations multiples, secteurs d'activité, technologies de famille. Fournis une liste de 3 à 10 variantes courantes.",
    "— `hybrid_keywords_llm` pour les critères qui combinent un domaine nommable ET une nuance contextuelle, typiquement les expériences (management, recrutement, gestion de projet…). Fournis une liste de 3 à 8 mots-clés gardiens.",
    "— `llm_with_quote` pour les critères subjectifs, interprétatifs ou contextuels qui ne se prêtent pas au matching textuel (soft skills, qualités personnelles, ajustement culturel). PAS de mots-clés (`keywords: []`).",
    "Si tu hésites entre deux méthodes, privilégie SYSTÉMATIQUEMENT la plus déterministe compatible avec la nature du critère (fiabilité et traçabilité maximales).",
    '',
    '── EXEMPLE ──',
    'FDP : Comptable senior, CDI, Paris, 50-65K, missions = tenue compta générale + clôtures mensuelles + déclarations fiscales + supervision juniors. Skills = IFRS, consolidation, SAP, Excel avancé, anglais.',
    'Sortie attendue :',
    '{',
    '  "criteria": [',
    '    { "label": "Diplôme comptable Bac+5 (DSCG/DEC ou équivalent)", "level": "obligatoire", "verificationMethod": "keywords_exact", "keywords": ["DSCG", "DEC", "Bac+5 comptabilité"] },',
    '    { "label": "5+ ans d\'expérience en comptabilité générale", "level": "obligatoire", "verificationMethod": "hybrid_keywords_llm", "keywords": ["comptabilité générale", "comptable"] },',
    '    { "label": "Maîtrise des normes IFRS", "level": "critique", "verificationMethod": "keywords_with_variants", "keywords": ["IFRS", "normes internationales", "IAS"] },',
    '    { "label": "Pratique avérée de SAP", "level": "tres_important", "verificationMethod": "keywords_exact", "keywords": ["SAP"] },',
    '    { "label": "Rigueur et autonomie", "level": "souhaitable", "verificationMethod": "llm_with_quote", "keywords": [] }',
    '  ]',
    '}',
    '',
    '── FORMAT DE SORTIE STRICT (JSON UNIQUEMENT) ──',
    '{',
    '  "criteria": [',
    '    { "label": "<verbe + objet>", "level": "<un des 6 niveaux>", "verificationMethod": "<une des 4 méthodes>", "keywords": ["<mot-clé>", "…"] }',
    '  ]',
    '}',
    "Pas de poids — les poids sont dérivés du niveau côté serveur. `keywords` vide pour `llm_with_quote`.",
  ].join('\n');
}

export function buildScoringUserPrompt(fdp: FDPInProgress): string {
  const lines: string[] = ['Voici la fiche de poste validée :', ''];
  for (const [key, field] of Object.entries(fdp.fields)) {
    const label = FIELD_LABELS[field.key] ?? key;
    const value = formatFieldValue(field.value);
    lines.push(`- ${label} : ${value}`);
  }
  lines.push(
    '',
    'Produis la fiche de scoring au format JSON demandé (8 à 15 critères répartis sur les 6 niveaux).',
  );
  return lines.join('\n');
}

function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '∅';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
