/**
 * Prompts système du Mail Composer (Session 5 round 4).
 *
 * Deux modes de production :
 *   - 'reject' : mail de refus, factuel, courtois, motif basé sur la
 *     justification CV Analyzer (jamais condescendant, jamais de
 *     copier-coller du verdict — le motif est reformulé). Pas de
 *     porte ouverte fausse (« on reste en contact ») si on ne compte
 *     pas réellement le faire.
 *   - 'invite' : mail d'invitation à un entretien, avec le lien
 *     Cal.com inclus. Ton chaleureux, court (4-6 phrases), pas de
 *     deuxième CTA concurrent.
 *
 * Le LLM rend HTML simple (paragraphes <p> + 1 <a> pour le lien
 * éventuel). Pas de table, pas de CSS inline complexe — le rendu
 * Resend gère le minimum.
 */

import type { CVAnalysisResult } from '@/types/cv-analysis';

export type MailComposerMode = 'reject' | 'invite';

export type MailComposerContext = {
  mode: MailComposerMode;
  candidate: CVAnalysisResult;
  jobTitle: string | null;
  campaignId: string;
  /** Pour mode='invite' uniquement, sinon ignoré. */
  bookingUrl?: string;
};

export function buildMailComposerSystemPrompt(): string {
  return [
    "Tu es le Mail Composer du département RH virtuel QWESTINUM. Tu rédiges un email court, courtois et factuel à destination d'un candidat à un poste.",
    '',
    'Règles ABSOLUES :',
    "- Ton métier, jamais corporate vide. Jamais d'emoji. Jamais d'exclamation excessive.",
    "- Pas de formules creuses (« nous avons étudié votre candidature avec attention »). Va à l'essentiel.",
    "- Pour un REFUS : reconnais le profil sans complaisance, donne UN motif concret (pas une litanie), termine sobrement. PAS de « nous gardons votre CV » si ce n'est pas vrai. Format : 3-5 phrases, max 90 mots.",
    "- Pour une INVITATION : annonce la suite, donne le lien de prise de RDV en clair (cliquable), précise la durée prévue (30 min sauf indication). Ton chaleureux mais professionnel. Format : 4-6 phrases, max 110 mots.",
    '',
    "Format de sortie — JSON STRICT, exactement ce schéma :",
    '{',
    '  "subject": "<objet du mail, ≤ 70 caractères, jamais en majuscules>",',
    '  "html": "<corps en HTML simple : 2 à 4 balises <p>, éventuellement 1 <a href=\\"...\\"> pour le lien Cal.com (mode invitation uniquement). Pas de styles inline. Pas d\'images. Pas de tables.>"',
    '}',
  ].join('\n');
}

export function buildMailComposerUserPrompt(ctx: MailComposerContext): string {
  const lines: string[] = [];
  if (ctx.mode === 'reject') {
    lines.push(
      'Mode : refus.',
      '',
      `Poste : ${ctx.jobTitle ?? 'non précisé'} (campagne ${ctx.campaignId}).`,
      `Candidat : ${ctx.candidate.candidateName}.`,
      `Score : ${ctx.candidate.score}/100 (seuil non atteint).`,
      '',
      'Verdict du CV Analyzer (à reformuler, ne jamais copier-coller) :',
      ctx.candidate.justification,
      '',
      "Synthèse du profil :",
      ctx.candidate.summary,
      '',
      'Rédige le mail de refus. Reste factuel, donne UN motif principal, courtois mais bref.',
    );
  } else {
    lines.push(
      'Mode : invitation à un entretien.',
      '',
      `Poste : ${ctx.jobTitle ?? 'non précisé'} (campagne ${ctx.campaignId}).`,
      `Candidat : ${ctx.candidate.candidateName}.`,
      `Score : ${ctx.candidate.score}/100 (au-dessus du seuil).`,
      '',
      "Synthèse du profil (contexte interne, NE PAS recopier dans le mail) :",
      ctx.candidate.summary,
      '',
      `Lien Cal.com à inclure : ${ctx.bookingUrl ?? '(à configurer)'}`,
      '',
      "Rédige l'invitation. Annonce que la candidature est retenue pour la suite, propose de choisir un créneau via le lien, précise la durée (30 min). Pas de mention du score ou de la synthèse interne.",
    );
  }
  return lines.join('\n');
}

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
    'Méthode :',
    "1. Questions de validation des points forts (« Vous avez démontré X dans le CV — pouvez-vous me raconter un cas concret où vous avez … ? »).",
    "2. Questions de clarification des points d'attention (sans les nommer comme faiblesses — formulation neutre).",
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
  candidate: CVAnalysisResult;
  jobTitle: string | null;
  campaignId: string;
}): string {
  const c = args.candidate;
  return [
    `Poste : ${args.jobTitle ?? 'non précisé'} (campagne ${args.campaignId}).`,
    `Candidat : ${c.candidateName}.`,
    `Score : ${c.score}/100.`,
    '',
    'Synthèse :',
    c.summary,
    '',
    `Points forts : ${c.strengths.join(' ; ')}`,
    `Points d'attention : ${c.weaknesses.length > 0 ? c.weaknesses.join(' ; ') : 'aucun majeur'}`,
    '',
    'Verdict :',
    c.justification,
    '',
    "Génère la trame d'entretien.",
  ].join('\n');
}
