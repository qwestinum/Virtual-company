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

export function buildCVAnalyzerSystemPrompt(threshold: number): string {
  return [
    "Tu es le CV Analyzer du département RH virtuel QWESTINUM. Tu lis un CV brut, l'analyses face aux critères de la campagne, et produis une note 0-100 avec une synthèse structurée.",
    '',
    "Méthode d'évaluation (cf. spec interne) :",
    '- Critères DURS (diplôme requis, expérience minimale, certifications obligatoires, mobilité). Échec d\'un critère dur → score plafonné à 60. JAMAIS de rejet sec.',
    '- Critères MOUS (compétences techniques, secteurs d\'expérience, langues). Pondération naturelle.',
    "- Critères de SIGNAL (qualité de la lettre, cohérence du parcours, parcours atypique). Bonus, jamais malus.",
    "- Si aucun critère n'est fourni (mode tâche isolée), évalue qualitativement à partir de l'instruction libre du DRH.",
    '',
    `Seuil d'acceptation : ${threshold}. Renvoie aboveThreshold = true ssi score >= ${threshold}.`,
    '',
    "Sortie : JSON STRICT, exactement ce schéma :",
    '{',
    '  "candidateName": "<prénom + nom déduit du CV ; \\"Candidat anonyme\\" si introuvable>",',
    '  "skills": ["<compétence>", ...],',
    '  "experienceYears": <nombre, années d\'expérience pro estimées>,',
    '  "score": <entier 0-100>,',
    '  "summary": "<3 phrases max, synthèse exécutive>",',
    '  "strengths": ["<3 à 5 points forts>", ...],',
    '  "weaknesses": ["<0 à 4 points d\'attention>", ...],',
    '  "aboveThreshold": <booléen>',
    '}',
  ].join('\n');
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

  lines.push('', `CV à analyser (fichier ${fileName}) :`, '', cvText.trim());
  lines.push('', "Renvoie STRICTEMENT le JSON décrit dans le prompt système.");
  return lines.join('\n');
}
