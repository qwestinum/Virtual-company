import { rejectionCause, isKnockout } from '@/lib/scoring';
import type { CVApplication, CVBatchSummary } from '@/types/cv-analysis';
import {
  CANDIDATE_STATUS_LABELS,
  SCORING_LEVEL_LABELS,
  SCORING_LEVELS,
  type LlmDecision,
} from '@/types/scoring';

/** Icône par verdict LLM (lisibilité « en un coup d'œil »). */
const DECISION_ICON: Record<LlmDecision, string> = {
  satisfait: '✅',
  partiel: '🟡',
  non: '❌',
  non_verifiable: '❔',
};

/** Rang de criticité (rédhibitoire = 0, le plus critique en tête). */
const LEVEL_RANK: Record<(typeof SCORING_LEVELS)[number], number> =
  SCORING_LEVELS.reduce(
    (acc, level, idx) => {
      acc[level] = idx;
      return acc;
    },
    {} as Record<(typeof SCORING_LEVELS)[number], number>,
  );

/**
 * Rapport agrégé d'un batch CV en Markdown téléchargeable (C6/6b).
 * En-tête synthèse + décomposition des écartés par cause (diagnostic fiche),
 * puis une section par CV avec ÉVALUATION PAR CRITÈRE (« on montre le travail »),
 * échecs durs, et narration.
 */
export function renderCVBatchMarkdown(
  summary: CVBatchSummary,
  campaignId: string | null,
): string {
  const rejected = summary.perCV.filter(
    (cv) => cv.scoringResult.status === 'rejected',
  );
  const byCause = { below_threshold: 0, cap: 0, knockout: 0 };
  for (const cv of rejected) {
    const cause = rejectionCause(cv.scoringResult);
    if (cause) byCause[cause] += 1;
  }

  const lines: string[] = [
    `# Rapport d'analyse CV${campaignId ? ` — ${campaignId}` : ''}`,
    '',
    `Total analysés : **${summary.total}**  `,
    `Acceptés automatiquement (score ≥ ${summary.thresholdHigh}) : **${summary.aboveThreshold}**  `,
    `Zone de validation [${summary.thresholdLow}–${summary.thresholdHigh}[ : à trancher par l'humain`,
  ];
  if (rejected.length > 0) {
    lines.push(
      '',
      `Écartés : **${rejected.length}**`,
      `- Sous le seuil : ${byCause.below_threshold}`,
      `- Cap critère obligatoire : ${byCause.cap}`,
      `- Knockout critère rédhibitoire : ${byCause.knockout}`,
    );
  }
  lines.push('', '---', '');

  for (const cv of summary.perCV) {
    lines.push(...renderApplication(cv));
  }

  return lines.join('\n');
}

function renderApplication(cv: CVApplication): string[] {
  const { candidate, scoringResult, narration } = cv;
  const knockoutTag = isKnockout(scoringResult) ? ' (knockout)' : '';
  const statusLabel = CANDIDATE_STATUS_LABELS[scoringResult.status];

  const lines: string[] = [
    `## ${candidate.fullName} — ${scoringResult.totalScore}/100${knockoutTag} — ${statusLabel}`,
    `Fichier : \`${candidate.fileName}\``,
    '',
  ];

  const contactBits: string[] = [];
  contactBits.push(
    candidate.email
      ? `Email : ${candidate.email}`
      : 'Email : *manquant — contact à retrouver*',
  );
  if (candidate.phone) contactBits.push(`Téléphone : ${candidate.phone}`);
  lines.push(contactBits.join('  · '), '', narration.summary, '');

  // Évaluation par critère — triée par criticité décroissante (durs en tête).
  lines.push('### Évaluation par critère');
  const ordered = [...scoringResult.breakdown].sort(
    (a, b) => LEVEL_RANK[a.criticityLevel] - LEVEL_RANK[b.criticityLevel],
  );
  for (const b of ordered) {
    const quote = b.llmCVQuote ? ` · « ${b.llmCVQuote} »` : '';
    lines.push(
      `- ${DECISION_ICON[b.llmDecision]} ${b.criterionLabel} [${SCORING_LEVEL_LABELS[b.criticityLevel]}] — ${b.llmDecision}${quote}`,
    );
  }
  lines.push('');

  if (scoringResult.hardFailures.length > 0) {
    lines.push('### Échecs sur critères durs');
    for (const h of scoringResult.hardFailures) {
      const reason = h.reason === 'unsatisfied' ? 'non satisfait' : 'non vérifiable';
      lines.push(`- ${h.criterionLabel} (${reason})`);
    }
    lines.push('');
  }

  if (narration.strengths.length > 0) {
    lines.push('### Points forts');
    for (const s of narration.strengths) lines.push(`- ${s}`);
    lines.push('');
  }
  if (narration.weaknesses.length > 0) {
    lines.push("### Points d'attention");
    for (const w of narration.weaknesses) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('### Verdict', narration.justification, '', '---', '');
  return lines;
}

export function buildCVBatchSummary(
  perCV: CVApplication[],
  thresholdLow: number,
  thresholdHigh: number,
): CVBatchSummary {
  return {
    total: perCV.length,
    aboveThreshold: perCV.filter((c) => c.scoringResult.status === 'accepted')
      .length,
    thresholdLow,
    thresholdHigh,
    perCV,
  };
}

export function suggestCVReportFileName(campaignId: string | null): string {
  const id = campaignId ?? 'tasks';
  // Date + heure + court suffixe aléatoire : chaque analyse produit un nom
  // UNIQUE. Sinon, plusieurs uploads le même jour collisionnent sur le même
  // fichier de stockage → le rapport ouvert restait figé sur la 1ʳᵉ version.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `rapport-cv-${id}-${stamp}-${suffix}.md`;
}
