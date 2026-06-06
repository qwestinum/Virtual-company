/**
 * Phase NARRATION du CV Analyzer (C5).
 *
 * La narration RH est rédigée À PARTIR du `ScoreResult` déjà calculé par
 * `scoreCandidat` — jamais l'inverse. Le LLM ne recalcule ni ne conteste le
 * score : il l'explique en langage RH. En cas d'échec d'extraction (après
 * retry), `buildFallbackNarration` produit une narration déterministe dérivée
 * du même `ScoreResult` (le principe « narration depuis le score » est
 * respecté même hors LLM).
 *
 * Module pur (prompts + fallback), sans dépendance serveur.
 */

import type { CVNarration } from '@/types/cv-analysis';
import type { ScoreResult } from '@/types/scoring';

export function buildNarrationSystemPrompt(): string {
  return [
    "Tu es le rédacteur RH du CV Analyzer. À partir d'un RÉSULTAT DE SCORING DÉJÀ CALCULÉ (score, statut, décisions par critère, échecs sur critères durs), tu rédiges une synthèse lisible pour le donneur d'ordre.",
    '',
    "Règle absolue : tu NE recalcules JAMAIS le score et tu NE le contestes pas. Le score et le statut sont des FAITS d'entrée — tu les expliques, tu ne les juges pas. N'invente aucun élément absent du détail fourni.",
    '',
    'Sortie : JSON STRICT, exactement ce schéma :',
    '{',
    '  "summary": "<synthèse exécutive, 3 phrases max, cohérente avec le score et le statut>",',
    '  "strengths": ["<point fort factuel>", ...],',
    '  "weaknesses": ["<point d\'attention factuel>", ...],',
    '  "justification": "<1 à 2 phrases expliquant le verdict au regard des critères ; factuel, jamais condescendant>"',
    '}',
    'Aucun champ supplémentaire, aucune note chiffrée inventée.',
  ].join('\n');
}

function statusLabel(status: ScoreResult['status']): string {
  return status === 'accepted' ? 'retenu' : 'écarté';
}

function reasonLabel(reason: 'unsatisfied' | 'unverifiable'): string {
  return reason === 'unsatisfied' ? 'non satisfait' : 'non vérifiable';
}

export function buildNarrationUserPrompt(
  score: ScoreResult,
  candidateName: string,
): string {
  const lines: string[] = [
    `Candidat : ${candidateName}`,
    `Score calculé (NE PAS recalculer) : ${score.totalScore}/100 — statut : ${statusLabel(score.status)}.`,
    '',
  ];

  if (score.hardFailures.length > 0) {
    lines.push('Échecs sur critères durs :');
    for (const h of score.hardFailures) {
      lines.push(`- ${h.criterionLabel} (${reasonLabel(h.reason)})`);
    }
    lines.push('');
  }

  lines.push('Détail par critère :');
  for (const b of score.breakdown) {
    const quote = b.llmCVQuote ? ` (« ${b.llmCVQuote} »)` : '';
    lines.push(
      `- « ${b.criterionLabel} » [${b.criticityLevel}] → ${b.llmDecision}${quote}`,
    );
  }
  lines.push(
    '',
    'Rédige la synthèse RH STRICTEMENT au format JSON demandé, à partir de ces éléments. Ne recalcule ni ne conteste le score.',
  );
  return lines.join('\n');
}

/**
 * Narration déterministe de secours, dérivée du `ScoreResult` (aucun LLM).
 * Utilisée quand l'extraction de narration échoue après retry — la candidature
 * reste exploitable côté DRH. Respecte le principe « narration depuis le
 * score » : forces = SOFT démontrés, attentions = échecs durs + SOFT manqués.
 */
export function buildFallbackNarration(score: ScoreResult): CVNarration {
  const retenu = score.status === 'accepted';
  const soft = score.breakdown.filter((b) => b.behavior === 'SOFT_WEIGHTED');

  const strengths = soft
    .filter((b) => b.llmDecision === 'satisfait' || b.llmDecision === 'partiel')
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)
    .map((b) => b.criterionLabel);

  const weaknesses = [
    ...score.hardFailures.map(
      (h) => `${h.criterionLabel} (${reasonLabel(h.reason)})`,
    ),
    ...soft
      .filter((b) => b.llmDecision === 'non' || b.llmDecision === 'non_verifiable')
      .map((b) => b.criterionLabel),
  ].slice(0, 6);

  const summary = retenu
    ? `Profil retenu avec un score de ${score.totalScore}/100 au regard des critères de la campagne.`
    : `Profil écarté avec un score de ${score.totalScore}/100${
        score.hardFailures.length > 0
          ? `, dont ${score.hardFailures.length} critère(s) dur(s) en échec`
          : ''
      }.`;

  const justification = retenu
    ? "Le candidat dépasse le seuil d'acceptation sur les critères pondérés, sans échec rédhibitoire."
    : score.hardFailures.length > 0
      ? 'Le verdict tient à un ou plusieurs critères durs non démontrés ; un arbitrage humain reste possible au vu du détail.'
      : "Le score pondéré reste sous le seuil d'acceptation de la campagne.";

  return { summary, strengths, weaknesses, justification };
}
