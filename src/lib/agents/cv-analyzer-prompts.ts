/**
 * Prompts système du CV Analyzer (Session 4).
 *
 * L'agent reçoit un texte de CV brut + des critères (FDP qualifiée OU
 * instruction libre en tâche isolée hors campagne) + un seuil
 * d'acceptation. Il retourne un score 0-100 et une analyse structurée
 * conforme à la spec §4.5 (critères durs/mous/signal).
 *
 * Règle critique : un échec sur un critère DUR plafonne le score sans
 * pour autant rejeter automatiquement le candidat — statut « à
 * arbitrer » côté Manager (ici représenté par `aboveThreshold = false`
 * et `weaknesses` qui mentionnent l'écueil).
 */

import type { CVAnalysisCriteria } from '@/types/cv-analysis';
import {
  isKnockoutCriterion,
  SCORING_LEVEL_LABELS,
  type ScoringSheet,
} from '@/types/scoring';

export function buildCVAnalyzerSystemPrompt(
  threshold: number,
  hasScoringSheet: boolean = false,
): string {
  const lines: string[] = [
    "Tu es le CV Analyzer du département RH virtuel QWESTINUM. Tu lis un CV brut, l'analyses face aux critères de la campagne, et produis une note 0-100 avec une synthèse structurée.",
    '',
  ];

  if (hasScoringSheet) {
    lines.push(
      "── MODE GRILLE PONDÉRÉE ──",
      "Une fiche de scoring validée est fournie dans le bloc utilisateur. Chaque critère a un NIVEAU et un POIDS explicite. Ta note doit refléter cette grille :",
      "1. Pour chaque critère NON rédhibitoire, estime mentalement un degré de match entre 0 (absent) et 1 (clairement démontré). Le score brut = Σ (weight × match) / Σ weight × 100, arrondi.",
      "2. Pour chaque critère RÉDHIBITOIRE : si tu ne trouves AUCUN signal dans le CV qui le démontre, le score final est IMMÉDIATEMENT 0. Pas de moyenne, pas de tolérance — le knockout est sec.",
      "3. Si tous les rédhibitoires sont démontrés, tu appliques la moyenne pondérée des autres critères.",
      "4. Mentionne dans `strengths` les critères haut-poids démontrés (cite leur label), dans `weaknesses` les critères haut-poids absents ou faibles.",
      '',
    );
  } else {
    lines.push(
      "Méthode d'évaluation (cf. spec interne) :",
      '- Critères DURS (diplôme requis, expérience minimale, certifications obligatoires, mobilité). Échec d\'un critère dur → score plafonné à 60. JAMAIS de rejet sec.',
      '- Critères MOUS (compétences techniques, secteurs d\'expérience, langues). Pondération naturelle.',
      "- Critères de SIGNAL (qualité de la lettre, cohérence du parcours, parcours atypique). Bonus, jamais malus.",
      "- Si aucun critère n'est fourni (mode tâche isolée), évalue qualitativement à partir de l'instruction libre du DRH.",
      '',
    );
  }

  lines.push(
    `Seuil d'acceptation : ${threshold}. Renvoie aboveThreshold = true ssi score >= ${threshold}.`,
    '',
    "Sortie : JSON STRICT, exactement ce schéma :",
    '{',
    '  "candidateName": "<prénom + nom déduit du CV ; \\"Candidat anonyme\\" si introuvable>",',
    '  "email": "<email du CV — adresse complète valide, ou null si rien d\'extractable>",',
    '  "phone": "<téléphone du CV au format international quand possible, ou null si rien>",',
    '  "skills": ["<compétence>", ...],',
    '  "experienceYears": <nombre, années d\'expérience pro estimées>,',
    '  "score": <entier 0-100>,',
    '  "summary": "<3 phrases max, synthèse exécutive>",',
    '  "strengths": ["<3 à 5 points forts>", ...],',
    '  "weaknesses": ["<0 à 4 points d\'attention>", ...],',
    '  "justification": "<1 à 2 phrases qui expliquent POURQUOI ce score, en ciblant les éléments concrets du CV vs critères ; sera réutilisée pour rédiger un mail de refus ou un brief d\'entretien — sois factuel, jamais condescendant>",',
    '  "aboveThreshold": <booléen>',
    '}',
    '',
    "Règles d'extraction des contacts :",
    "- email : extrais l'adresse email TELLE QUELLE depuis le CV (ne reformate pas, n'invente rien). Si plusieurs emails (LinkedIn vs perso), prends l'adresse personnelle / directe en priorité. Si rien d'extractable ou format invalide, mets `null`. NE METS JAMAIS un placeholder ou un email d'exemple.",
    "- phone : idem, prends-le tel quel ou null. Préserve le format international si présent (+33 …).",
    "- candidateName : extrais le nom complet. Évite les titres (\"Mr\", \"Mme\"). Si pas de nom dans le CV, mets exactement \"Candidat anonyme\".",
  );
  return lines.join('\n');
}

/**
 * Sérialise la fiche de scoring en bloc texte injectable dans le user
 * prompt. Format : titre + groupes par niveau, chaque ligne contenant
 * label (+ poids ou marqueur KO). Lisible par le LLM sans risque
 * d'ambiguïté JSON.
 */
export function formatScoringSheetForPrompt(sheet: ScoringSheet): string {
  const lines: string[] = [
    '── Fiche de scoring (grille pondérée à appliquer) ──',
  ];
  const knockouts = sheet.criteria.filter(isKnockoutCriterion);
  const others = sheet.criteria.filter((c) => !isKnockoutCriterion(c));
  if (knockouts.length > 0) {
    lines.push(`${SCORING_LEVEL_LABELS.redhibitoire} (KNOCKOUT — absent ⇒ score 0) :`);
    for (const c of knockouts) {
      lines.push(`  - ${c.label}`);
    }
  }
  for (const level of [
    'obligatoire',
    'critique',
    'tres_important',
    'important',
    'souhaitable',
  ] as const) {
    const subset = others.filter((c) => c.level === level);
    if (subset.length === 0) continue;
    lines.push(`${SCORING_LEVEL_LABELS[level]} :`);
    for (const c of subset) {
      lines.push(`  - ${c.label} (poids ${c.weight})`);
    }
  }
  return lines.join('\n');
}

export function buildCVAnalyzerUserPrompt(args: {
  cvText: string;
  criteria: CVAnalysisCriteria;
  fileName: string;
}): string {
  const { cvText, criteria, fileName } = args;
  const lines: string[] = ['Critères de la campagne :', ''];

  if (criteria.freeText) {
    lines.push(`Instruction libre du DRH : ${criteria.freeText}`);
  } else {
    if (criteria.jobTitle) lines.push(`- Intitulé : ${criteria.jobTitle}`);
    if (criteria.seniority) lines.push(`- Séniorité : ${criteria.seniority}`);
    if (criteria.contractType)
      lines.push(`- Contrat : ${criteria.contractType}`);
    if (criteria.location) lines.push(`- Localisation : ${criteria.location}`);
    if (criteria.salaryRange)
      lines.push(`- Fourchette : ${criteria.salaryRange}`);
    if (criteria.mainMissions && criteria.mainMissions.length > 0) {
      lines.push('- Missions principales :');
      for (const m of criteria.mainMissions) lines.push(`  - ${m}`);
    }
    if (criteria.keySkills && criteria.keySkills.length > 0) {
      lines.push('- Compétences clés : ' + criteria.keySkills.join(', '));
    }
  }

  if (criteria.scoringSheet) {
    lines.push('', formatScoringSheetForPrompt(criteria.scoringSheet));
  }

  lines.push('', `CV à analyser (fichier ${fileName}) :`, '', cvText.trim());
  lines.push('', "Renvoie STRICTEMENT le JSON décrit dans le prompt système.");
  return lines.join('\n');
}
