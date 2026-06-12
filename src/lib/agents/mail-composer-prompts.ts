/**
 * Prompts système pour la TRAME D'ENTRETIEN destinée au DRH (round 4).
 *
 * Les messages candidat (acceptation+invitation, refus) ne sont plus rédigés
 * par le LLM : ils sont rendus de manière déterministe à partir des templates
 * configurés (cf. `@/lib/interview/mail-templates` et `interview-mail.ts`).
 * Ce module ne porte plus que la génération de la trame d'entretien.
 */

import type { MailCandidate } from '@/types/mail-candidate';

/**
 * Prompt pour la trame d'entretien envoyée au DRH (round 4). Le LLM
 * génère 6 à 8 questions ciblées qui exploitent le delta entre la FDP
 * et le profil du candidat : questions techniques sur les compétences
 * démontrées, vérifications sur les zones d'ombre (weaknesses), et
 * une ouverture motivationnelle.
 */
export function buildInterviewGuideSystemPrompt(): string {
  return [
    "Tu prépares une trame d'entretien à destination du DRH qui va recevoir le candidat. Tu génères 6 à 8 questions ciblées qui aident à creuser le profil rapidement (entretien découverte de 30 min).",
    '',
    'ANCRAGE STRICT (anti-hallucination) — RÈGLE ABSOLUE :',
    "- Ne te base QUE sur la synthèse, les points forts et les points d'attention FOURNIS. N'invente RIEN.",
    "- N'attribue JAMAIS au candidat une expérience, compétence, secteur ou domaine qui n'est pas explicitement écrit. En particulier, ne SUPPOSE PAS qu'il a de l'expérience dans le domaine du poste si ce n'est pas indiqué : formule alors la question pour VÉRIFIER (« Avez-vous déjà travaillé sur … ? »), jamais pour AFFIRMER (« Vous avez de l'expérience en … »).",
    "- Aucune extrapolation par analogie : une compétence dans un domaine n'en implique pas une autre.",
    '',
    'Méthode :',
    "1. Questions de validation des points forts RÉELLEMENT cités (« Le CV mentionne X — pouvez-vous me raconter un cas concret … ? »).",
    "2. Questions de clarification des points d'attention (sans les nommer comme faiblesses — formulation neutre, ouverte, qui ne présume pas la réponse).",
    "3. Une question motivationnelle / projection sur le poste à la fin.",
    '',
    "Format JSON STRICT :",
    '{',
    '  "questions": [',
    '    { "theme": "<étiquette courte ex. \\"Expérience IFRS\\">", "question": "<question en français, formulée en tu/vous selon le ton du candidat>" },',
    '    …',
    '  ]',
    '}',
    'Au moins 6 questions, au plus 8.',
  ].join('\n');
}

export function buildInterviewGuideUserPrompt(args: {
  candidate: MailCandidate;
  jobTitle: string | null;
  campaignId: string;
}): string {
  const c = args.candidate;
  // Un brief n'est généré QUE pour un candidat convoqué en entretien. S'il était
  // sous le seuil (`aboveThreshold` false), c'est qu'il a été REPÊCHÉ par une
  // décision humaine (basculement refus → acceptation). Il n'est donc PLUS
  // écarté : on reformule en conséquence et on ne diffuse pas la narration de
  // rejet (synthèse/verdict d'écartage).
  const repechage = !c.aboveThreshold;
  const lines: string[] = [
    `Poste : ${args.jobTitle ?? 'non précisé'} (campagne ${args.campaignId}).`,
    `Candidat : ${c.candidateName}.`,
    `Score d'analyse : ${c.score}/100.`,
    '',
  ];
  if (repechage) {
    lines.push(
      "CONTEXTE — DÉCISION HUMAINE (REPÊCHAGE) : le recruteur a DÉCIDÉ de recevoir ce candidat en entretien, alors que le pré-tri automatique l'avait initialement placé sous le seuil. Le candidat N'EST PLUS écarté/rejeté. NE le présente JAMAIS comme écarté, refusé, « sous le seuil » ou « non retenu ». Tout libellé de rejet dans la synthèse ci-dessous appartient au pré-tri AUTOMATIQUE qui a été OUTREPASSÉ — ignore-le. Le brief prépare un entretien normal : valide les points forts et explore (formulation neutre, bienveillante) les points que le pré-tri avait signalés.",
      '',
    );
  }
  lines.push(
    'Synthèse du profil :',
    c.summary,
    '',
    `Points forts : ${c.strengths.join(' ; ')}`,
    `Points à explorer en entretien : ${c.weaknesses.length > 0 ? c.weaknesses.join(' ; ') : 'aucun majeur'}`,
  );
  if (!repechage) {
    lines.push('', 'Verdict :', c.justification);
  }
  lines.push('', "Génère la trame d'entretien.");
  return lines.join('\n');
}
