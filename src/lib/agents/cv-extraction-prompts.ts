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

import type { CVFactLedger } from '@/types/cv-analysis';
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

// ── 1bis. Relevé de faits du CV (ledger — source canonique partagée) ────────

export function buildLedgerSystemPrompt(): string {
  return [
    "Tu es l'extracteur de FAITS du CV Analyzer RH. Tu lis un CV brut et tu en dresses un RELEVÉ purement factuel de ce que le candidat démontre. Tu ne juges pas, tu ne notes pas, tu n'évalues aucun critère : tu LISTES ce qui figure dans le CV.",
    '',
    'Ce relevé servira de SOURCE UNIQUE pour évaluer ensuite chaque critère — il doit donc être EXHAUSTIF et FIDÈLE au CV.',
    '',
    'Sortie : JSON STRICT, exactement ce schéma (aucun champ supplémentaire) :',
    '{',
    '  "yearsExperience": <nombre d\'années d\'expérience TOTAL tel qu\'ÉCRIT dans le CV, ou null si non affiché explicitement — ne le RECALCULE jamais à partir des dates>,',
    '  "tools": [<outils / technologies / frameworks NOMMÉS dans le CV : « JIRA », « Xray », « Selenium »…>],',
    '  "methodologies": [<méthodologies citées : « Agile », « Scrum », « Kanban »…>],',
    '  "skills": [<compétences / savoir-faire démontrés : « automatisation des tests », « communication »…>],',
    '  "domains": [<domaines / secteurs : « test logiciel », « finance »…>]',
    '}',
    '',
    'Règles :',
    "- N'INVENTE rien. Chaque élément listé doit figurer dans le CV. En cas de doute, ne l'ajoute pas.",
    "- NORMALISE les noms d'outils sous une forme canonique mais reconnaissable (ex. « X-Ray », « xray » → « Xray »). Un outil cité une fois suffit pour figurer au relevé.",
    '- Listes vides autorisées (`[]`) si le CV ne contient rien pour ce champ.',
    '- Aucun jugement, aucune note, aucun critère ici — uniquement le relevé brut.',
  ].join('\n');
}

export function buildLedgerUserPrompt(cvText: string, fileName: string): string {
  return [
    `CV à relever (fichier ${fileName}) :`,
    '',
    cvText.trim(),
    '',
    'Renvoie STRICTEMENT le JSON du relevé de faits décrit dans le prompt système.',
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
    '- "non"            : le CV affirme POSITIVEMENT le contraire du critère (preuve d\'ABSENCE, p. ex. « aucune expérience en X », ou une situation qui exclut le critère).',
    '- "non_verifiable" : le CV ne donne AUCUN élément permettant de trancher (le critère n\'est tout simplement pas abordé).',
    '',
    "── RÈGLE « non » vs « non_verifiable » (IMPÉRATIVE) ──",
    "\"non\" est RARE : ne l'emploie QUE si le CV démontre l'absence ou l'inverse du critère. Si tu ne trouves simplement PAS la preuve d'un critère, ce n'est PAS \"non\" — c'est \"non_verifiable\". « Je n'ai pas vu telle compétence » = \"non_verifiable\", JAMAIS \"non\". Confondre les deux fait passer un élément ABSENT-de-ta-lecture pour un élément CONTREDIT par le CV.",
    '',
    "Pour un critère binaire (ex. diplôme acquis ou non), tranche en \"satisfait\" ou \"non\" — n'utilise \"partiel\" que pour une vraie atteinte intermédiaire.",
    '',
    'Pour chaque critère : une justification courte (1 phrase) et une CITATION LITTÉRALE du CV qui fonde la décision (chaîne vide "" si non vérifiable).',
    '',
    '── RÈGLES D\'ANCRAGE (anti-hallucination, IMPÉRATIVES) ──',
    "- SOURCE CANONIQUE : un RELEVÉ DE FAITS du candidat (outils, méthodologies, compétences, domaines, années) t'est fourni AVANT le CV. C'est la référence partagée par TOUS les critères. Un élément présent au relevé (ex. l'outil « Xray ») est PRÉSENT pour CHAQUE critère qui le vise : tu ne peux JAMAIS le déclarer « non » (absent) pour un critère alors qu'il figure au relevé. Inversement, juge un critère cohéremment d'un critère à l'autre — un même fait reçoit le même statut partout.",
    "- Pour \"satisfait\" ou \"partiel\", tu DOIS fournir dans llmCVQuote un extrait VERBATIM du CV qui le prouve. Sans extrait littéral probant → \"non_verifiable\" (jamais \"satisfait\").",
    "- N'attribue JAMAIS au candidat une expérience, un domaine, une compétence ou un chiffre qui ne figure pas EXPLICITEMENT dans le CV. Si le critère porte sur un domaine X et que le CV décrit un domaine Y différent, la réponse est \"non\" (ou \"non_verifiable\") — surtout pas \"satisfait\".",
    "- Cette règle vaut AUSSI pour \"partiel\" : une activité d'un AUTRE domaine n'est PAS un crédit partiel, même si elle semble proche par analogie. La citation doit soutenir DIRECTEMENT le critère, pas un sujet voisin. Exemples à NE PAS faire (→ \"non\") : citer « stratégie de TEST » pour un critère « pipelines de DONNÉES » ; citer « management d'équipes de TEST » pour « équipes de DATA SCIENCE » ; citer « procédures d'organisation interne » pour « infrastructures de données ». Le management, le test ou la qualité logicielle NE valent PAS de l'ingénierie de données.",
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
  ledger: CVFactLedger,
): string {
  const lines: string[] = ['Critères de la fiche de scoring à évaluer :', ''];
  sheet.criteria.forEach((c, idx) => {
    lines.push(
      `${idx + 1}. criticité=${SCORING_LEVEL_LABELS[c.level]} | « ${c.label} »`,
    );
  });
  lines.push(
    '',
    'RELEVÉ DE FAITS du candidat (source canonique — un fait listé ici est PRÉSENT pour tout critère qui le vise) :',
    formatLedger(ledger),
    '',
    'CV à évaluer :',
    '',
    cvText.trim(),
    '',
    'Renvoie STRICTEMENT le JSON `verdicts` décrit dans le prompt système, un verdict par critère ci-dessus, en reportant son NUMÉRO dans `criterionId`.',
  );
  return lines.join('\n');
}

/** Rend le relevé de faits en lignes lisibles pour le prompt verdicts. */
function formatLedger(ledger: CVFactLedger): string {
  const fmt = (arr: string[]) => (arr.length > 0 ? arr.join(', ') : '—');
  return [
    `- Années d'expérience : ${ledger.yearsExperience ?? '—'}`,
    `- Outils / technologies : ${fmt(ledger.tools)}`,
    `- Méthodologies : ${fmt(ledger.methodologies)}`,
    `- Compétences : ${fmt(ledger.skills)}`,
    `- Domaines : ${fmt(ledger.domains)}`,
  ].join('\n');
}
