/**
 * Prompts de la PHASE EXTRACTION du CV Analyzer (C4).
 *
 * Deux extractions distinctes, déterministes (seed/temperature fixés par
 * `chatCompleteJson`), le LLM ne calculant JAMAIS de score :
 *   1. `candidate`  — données factuelles ANNEXES (identité, coordonnées,
 *      métadonnées, conformité). Aucune appréciation.
 *   2. `verdicts`   — une DÉCISION par critère de la fiche de scoring
 *      (satisfait/partiel/non/non_verifiable) + justification + citation
 *      littérale. Le calcul du score est fait ensuite par `scoreCandidat`.
 */

import {
  SCORING_LEVEL_LABELS,
  type ScoringSheet,
} from '@/types/scoring';

// ── 1. Extraction des données candidat (factuel annexe) ─────────────────────

export function buildCandidateExtractionSystemPrompt(): string {
  return [
    "Tu es l'extracteur de données factuelles du CV Analyzer RH. Tu lis un CV brut et tu en extrais UNIQUEMENT des données factuelles annexes : identité, coordonnées, métadonnées, conformité. Tu ne juges pas, tu ne notes pas, tu n'évalues aucune compétence.",
    '',
    'Sortie : JSON STRICT, exactement ce schéma (aucun champ supplémentaire) :',
    '{',
    '  "isCv": <true/false — le document est-il une candidature (CV / résumé) ? false s\'il s\'agit manifestement d\'autre chose : facture, lettre administrative, page web, document vide ou illisible, etc.>,',
    '  "fullName": "<prénom + nom ; \\"Candidat non identifié\\" si introuvable>",',
    '  "email": "<adresse email telle quelle, ou null si rien d\'extractable>",',
    '  "phone": "<téléphone tel quel (format international si présent), ou null>",',
    '  "detectedLanguage": "<code langue principale du CV, ex. \\"fr\\", \\"en\\", ou null>",',
    '  "rightToWork": <true/false/null — mentionné explicitement uniquement (nationalité UE, permis de travail) ; null si non mentionné>,',
    '  "location": "<ville/région de résidence du candidat, ou null>",',
    '  "photoPresent": <true/false — une photo d\'identité est-elle présente sur le CV>',
    '}',
    '',
    "Règles : n'invente jamais une adresse ou un téléphone ; extrais TEL QUEL ou mets null. Ne déduis `rightToWork` que si le CV l'indique explicitement. Aucune compétence, aucun score, aucun point fort/faible ici — uniquement le factuel annexe.",
    "RÈGLE D'OR : si `isCv` est false (le document n'est PAS une candidature), mets `fullName` = \"Candidat anonyme\" et `email` = null. Ne récupère SURTOUT PAS une adresse au hasard dans un document qui n'est pas un CV (ce serait potentiellement celle du recruteur, pas d'un candidat).",
  ].join('\n');
}

export function buildCandidateExtractionUserPrompt(
  cvText: string,
  fileName: string,
): string {
  return [
    `CV à traiter (fichier ${fileName}) :`,
    '',
    cvText.trim(),
    '',
    'Renvoie STRICTEMENT le JSON des données factuelles annexes décrit dans le prompt système.',
  ].join('\n');
}

// ── 2. Extraction des décisions par critère (verdicts) ──────────────────────

export function buildVerdictsSystemPrompt(): string {
  return [
    "Tu es l'évaluateur par critère du CV Analyzer RH. Pour CHAQUE critère de la fiche de scoring fournie, tu rends une décision qualitative SANS calculer aucune note — le score est calculé ensuite par le système, pas par toi.",
    '',
    '── DÉCISIONS POSSIBLES (une par critère) ──',
    '- "satisfait"      : le CV démontre clairement le critère.',
    '- "partiel"        : le CV démontre partiellement le critère (atteinte intermédiaire).',
    '- "non"            : le CV démontre clairement que le critère n\'est PAS rempli.',
    '- "non_verifiable" : le CV ne donne AUCUN élément permettant de trancher.',
    '',
    "Pour un critère binaire (ex. diplôme acquis ou non), tranche en \"satisfait\" ou \"non\" — n'utilise \"partiel\" que pour une vraie atteinte intermédiaire.",
    '',
    'Pour chaque critère : une justification courte (1 phrase) et une CITATION LITTÉRALE du CV qui fonde la décision (chaîne vide "" si non vérifiable).',
    '',
    '── RÈGLES D\'ANCRAGE (anti-hallucination, IMPÉRATIVES) ──',
    "- Pour \"satisfait\" ou \"partiel\", tu DOIS fournir dans llmCVQuote un extrait VERBATIM du CV qui le prouve. Sans extrait littéral probant → \"non_verifiable\" (jamais \"satisfait\").",
    "- N'attribue JAMAIS au candidat une expérience, un domaine, une compétence ou un chiffre qui ne figure pas EXPLICITEMENT dans le CV. Si le critère porte sur un domaine X et que le CV décrit un domaine Y différent, la réponse est \"non\" (ou \"non_verifiable\") — surtout pas \"satisfait\".",
    "- Années d'expérience : reprends le nombre TEL QU'IL EST ÉCRIT dans le CV. Ne le recalcule pas toi-même à partir des dates (source d'erreurs). Si le CV n'affiche pas de total explicite et que tu n'es pas sûr → \"non_verifiable\".",
    '',
    'Sortie : JSON STRICT, exactement ce schéma :',
    '{',
    '  "verdicts": [',
    '    { "criterionId": "<le NUMÉRO du critère tel que listé : \\"1\\", \\"2\\", …>", "llmDecision": "satisfait|partiel|non|non_verifiable", "llmJustification": "<1 phrase>", "llmCVQuote": "<extrait littéral du CV ou \\"\\">" }',
    '  ]',
    '}',
    '',
    'Rends EXACTEMENT un verdict par critère fourni. Dans `criterionId`, reporte le NUMÉRO du critère (1, 2, 3…) tel qu\'il est listé dans le message — pas son libellé. Aucune note, aucun champ supplémentaire.',
  ].join('\n');
}

export function buildVerdictsUserPrompt(
  cvText: string,
  sheet: ScoringSheet,
): string {
  const lines: string[] = ['Critères de la fiche de scoring à évaluer :', ''];
  sheet.criteria.forEach((c, idx) => {
    lines.push(
      `${idx + 1}. criticité=${SCORING_LEVEL_LABELS[c.level]} | « ${c.label} »`,
    );
  });
  lines.push(
    '',
    'CV à évaluer :',
    '',
    cvText.trim(),
    '',
    'Renvoie STRICTEMENT le JSON `verdicts` décrit dans le prompt système, un verdict par critère ci-dessus, en reportant son NUMÉRO dans `criterionId`.',
  );
  return lines.join('\n');
}
