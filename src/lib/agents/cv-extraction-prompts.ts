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
    '  "skills": [<compétences TECHNIQUES / savoir-faire explicitement NOMMÉS ou directement décrits par une réalisation : « automatisation des tests », « clôture comptable »… — JAMAIS un savoir-être inféré>],',
    '  "domains": [<domaines / secteurs EXPLICITEMENT mentionnés dans le CV : « test logiciel », « finance »…>]',
    '}',
    '',
    'Règles :',
    "- N'INVENTE rien. Chaque élément listé doit figurer dans le CV. En cas de doute, ne l'ajoute pas.",
    "- Ce relevé sera traité ENSUITE comme la VÉRITÉ du candidat (un fait listé ici sera considéré acquis pour tout critère qui le vise). N'y mets donc QUE du littéral lu dans le CV, jamais une interprétation optimiste : un relevé sur-extrait fabrique de faux positifs en aval.",
    "- SAVOIR-ÊTRE / SOFT-SKILLS : ne liste « travail en équipe », « communication », « autonomie », « leadership », « agilité », « rigueur », « adaptabilité » et autres traits QUE si le CV les nomme ou les décrit explicitement (une phrase qui les illustre). Ne les DÉDUIS JAMAIS d'une réalisation technique : avoir « mis en place des projets d'automatisation » ne prouve ni le travail en équipe, ni l'agilité. Dans le doute, ne les liste pas.",
    "- DOMAINES : ne reporte que les secteurs réellement présents dans le parcours. N'ajoute JAMAIS le domaine du poste visé ou un domaine « proche » par analogie s'il n'est pas écrit.",
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
    "- BIAIS CONSERVATEUR — non_verifiable PAR DÉFAUT : en cas d'hésitation entre non_verifiable et N'IMPORTE LEQUEL des trois autres verdicts (satisfait, partiel, non), choisis TOUJOURS non_verifiable. Cette règle s'applique aux quatre verdicts SANS EXCEPTION : non_verifiable est le verdict par défaut dès que l'évidence textuelle n'est pas DIRECTE et EXPLICITE. Le doute n'est jamais tranché par toi — il est laissé au recruteur humain qui arbitrera.",
    "- SOURCE CANONIQUE : un RELEVÉ DE FAITS du candidat (outils, méthodologies, compétences, domaines, années) t'est fourni AVANT le CV. C'est la référence partagée par TOUS les critères. Un élément présent au relevé (ex. l'outil « Xray ») est PRÉSENT pour CHAQUE critère qui le vise : tu ne peux JAMAIS le déclarer « non » (absent) pour un critère alors qu'il figure au relevé. Inversement, juge un critère cohéremment d'un critère à l'autre — un même fait reçoit le même statut partout.",
    "- PRÉSENCE ≠ SATISFACTION : qu'un fait figure au relevé empêche de dire « non » (absent), mais n'impose JAMAIS « satisfait ». « Satisfait » exige que la PREUVE couvre le critère ENTIER (voir « critères composites » et « test de preuve » ci-dessous). Un fait au relevé qui ne couvre qu'une PARTIE du critère donne « partiel », pas « satisfait ».",
    "- Pour \"satisfait\" ou \"partiel\", tu DOIS fournir dans llmCVQuote un extrait VERBATIM du CV qui le prouve. Sans extrait littéral probant → \"non_verifiable\" (jamais \"satisfait\").",
    "- CITATION ANCRÉE SUR LE DOMAINE : pour tout verdict satisfait, partiel ou non sur un critère qui SPÉCIFIE un domaine, la llmCVQuote doit être une phrase LITTÉRALE du CV contenant EXPLICITEMENT ce domaine. Si aucune phrase du CV ne contient ce domaine → non_verifiable. Une citation portant sur un autre domaine, même proche, n'est JAMAIS une justification recevable.",
    "- N'attribue JAMAIS au candidat une expérience, un domaine, une compétence ou un chiffre qui ne figure pas EXPLICITEMENT dans le CV. Si le critère porte sur un domaine X et que le CV décrit un domaine Y différent, la réponse est \"non\" (ou \"non_verifiable\") — surtout pas \"satisfait\".",
    "- DISCIPLINE DU DOMAINE : avant d'évaluer un critère, identifie le(s) mot(s)-clé(s) de DOMAINE qu'il contient (ex. « recrutement » dans « expérience en recrutement »). Tu n'évalues ce critère QU'À PARTIR de phrases du CV qui mentionnent EXPLICITEMENT ce domaine. Ne reporte JAMAIS une expérience, une durée ou une compétence d'un AUTRE domaine — même proche, même présente au relevé de faits — pour juger un critère qui spécifie un domaine précis. Le qualificatif de domaine du critère prime TOUJOURS sur l'expérience générale du candidat.",
    "- ANCRAGE SUR L'OBJET EXACT : la preuve doit concerner EXACTEMENT ce que le critère vise — pas seulement le bon domaine, mais le bon INTERLOCUTEUR, la bonne ACTIVITÉ, le bon OUTIL. Une entité voisine ne compte pas. Exemples à NE PAS faire (→ \"non\" / \"non_verifiable\") : « collaboration avec les équipes de DÉVELOPPEMENT » prouvé par « interface avec les CLIENTS » (interlocuteur différent) ; « management d'équipes » prouvé par « gestion de projet » (activité différente) ; « expérience avec OUTIL A » prouvé par « OUTIL B » (outil différent).",
    "- Cette règle vaut AUSSI pour \"partiel\" : une activité d'un AUTRE domaine (ou visant un autre interlocuteur/objet) n'est PAS un crédit partiel, même si elle semble proche par analogie. La citation doit soutenir DIRECTEMENT le critère, pas un sujet voisin. Exemples à NE PAS faire (→ \"non\") : citer « stratégie de TEST » pour un critère « pipelines de DONNÉES » ; citer « management d'équipes de TEST » pour « équipes de DATA SCIENCE » ; citer « procédures d'organisation interne » pour « infrastructures de données ». Le management, le test ou la qualité logicielle NE valent PAS de l'ingénierie de données.",
    "- COUVERTURE des critères qui NOMMENT PLUSIEURS éléments (ex. « JIRA, TestRail », « Java et Python ») : la décision reflète la part RÉELLEMENT couverte — TOUS présents → \"satisfait\" ; SEULEMENT certains → \"partiel\" ; aucun → \"non_verifiable\"/\"non\". La llmCVQuote doit citer les éléments EXACTEMENT nommés par le critère, JAMAIS un substitut (ex. « Xray » ne prouve PAS « TestRail » : ce sont deux outils distincts). Si un seul des deux outils nommés figure au CV, c'est \"partiel\", pas \"satisfait\".",
    "- Années d'expérience : reprends le nombre TEL QU'IL EST ÉCRIT dans le CV. Ne le recalcule pas toi-même à partir des dates (source d'erreurs). Si le CV n'affiche pas de total explicite et que tu n'es pas sûr → \"non_verifiable\".",
    '',
    "- CRITÈRES COMPOSITES : un critère qui exige PLUSIEURS choses à la fois (ex. « travailler EN ÉQUIPE dans un environnement AGILE » = collaboration + agilité ; « piloter un BUDGET en autonomie » = budget + autonomie) n'est « satisfait » que si CHAQUE exigence est prouvée par le CV. Une seule exigence prouvée, l'autre absente → « partiel ». Aucune prouvée directement → « non_verifiable ». N'utilise JAMAIS la preuve d'UNE exigence pour valider tout le critère.",
    '',
    "- SAVOIR-ÊTRE / SOFT-SKILLS : « travail en équipe », « communication », « autonomie », « leadership », « agilité », « rigueur », « sens du résultat »… ne se DÉDUISENT JAMAIS d'une réalisation technique. Il faut une mention ou une illustration EXPLICITE dans le CV (« animation d'une équipe de 5 », « présentations en comité de direction »). Sans cela → « non_verifiable », jamais « satisfait ». EXEMPLE À NE PAS FAIRE : critère « capacité à travailler en équipe dans un environnement agile » jugé « satisfait » avec pour preuve « mise en place de projets d'automatisation » — l'automatisation ne prouve NI l'équipe NI l'agilité → « non_verifiable ».",
    '',
    "- TEST DE PREUVE (à appliquer AVANT de répondre « satisfait ») : relis ta llmCVQuote SEULE et demande-toi « cet extrait, à lui seul, démontre-t-il LITTÉRALEMENT chaque terme-clé du critère ? ». Si l'extrait ne fait qu'évoquer un sujet voisin, un contexte général, ou exige une inférence (« cela suppose donc que… ») → ce n'est PAS « satisfait ». La justification doit RELIER explicitement l'extrait au critère ; si tu dois écrire « ce qui implique / suggère / laisse penser », c'est que la preuve est insuffisante.",
    '',
    '── EXEMPLES — extrapolation de domaine à PROSCRIRE ──',
    'CRITÈRE : « Expérience en recrutement, au moins 2 ans »',
    "EXTRAIT CV : « 15 ans d'expérience en qualité logicielle »",
    '❌ MAUVAIS : satisfait (le LLM extrapole l’expérience générale du candidat).',
    '✓ BON : non_verifiable (aucune mention d’expérience en recrutement).',
    '',
    'CRITÈRE : « Expérience en recrutement, au moins 2 ans »',
    'EXTRAIT CV : « Stage de 6 mois en RH »',
    '❌ MAUVAIS : satisfait (durée extrapolée et domaine non vérifié).',
    '✓ BON : partiel ou non — selon que le stage évoque EXPLICITEMENT du recrutement.',
    '',
    'CRITÈRE : « Expérience en recrutement, au moins 2 ans »',
    "EXTRAIT CV : « 10 ans de management d'équipe technique »",
    '❌ MAUVAIS : partiel (le LLM infère « un manager participe au recrutement »).',
    '✓ BON : non_verifiable (aucune mention explicite d’activité de recrutement).',
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
  /**
   * Contexte hybride (Phase 3a) : criterionId → mots-clés gardiens DÉJÀ
   * détectés dans le CV. Une mention « nécessaires mais pas suffisants » est
   * ajoutée sous le critère concerné. Absent / vide ⇒ prompt IDENTIQUE à
   * l'existant (non-régression des grilles tout-LLM).
   */
  hybridContext?: Map<string, string[]>,
): string {
  const lines: string[] = ['Critères de la fiche de scoring à évaluer :', ''];
  sheet.criteria.forEach((c, idx) => {
    lines.push(
      `${idx + 1}. criticité=${SCORING_LEVEL_LABELS[c.level]} | « ${c.label} »`,
    );
    const found = hybridContext?.get(c.id);
    if (found && found.length > 0) {
      lines.push(
        `   Les termes suivants ont été détectés dans le CV : ${found.join(', ')}. ` +
          'Ces termes sont NÉCESSAIRES MAIS PAS SUFFISANTS pour conclure que le critère est satisfait. ' +
          "Vérifie pour chaque occurrence si le contexte d'apparition soutient effectivement le critère, " +
          "ou si l'occurrence est trompeuse (candidat objet et non sujet de l'action, contexte marginal, domaine étranger). " +
          'Applique les règles de discipline de domaine standard pour produire le verdict.',
      );
    }
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
