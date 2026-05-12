import type { CVAnalysisResult, CVBatchSummary } from '@/types/cv-analysis';

/**
 * Rapport agrégé d'un batch CV en Markdown téléchargeable.
 * En-tête synthèse, puis une section par CV avec score, synthèse,
 * forces, points d'attention.
 */
export function renderCVBatchMarkdown(
  summary: CVBatchSummary,
  campaignId: string | null,
): string {
  const lines: string[] = [
    `# Rapport d'analyse CV${campaignId ? ` — ${campaignId}` : ''}`,
    '',
    `Total analysés : **${summary.total}**  `,
    `Au-dessus du seuil (${summary.threshold}%) : **${summary.aboveThreshold}**`,
    '',
    '---',
    '',
  ];

  for (const cv of summary.perCV) {
    lines.push(`## ${cv.candidateName} — ${cv.score}/100`);
    lines.push(
      cv.aboveThreshold
        ? `Statut : **Retenu** · Fichier : \`${cv.fileName}\``
        : `Statut : **À arbitrer** · Fichier : \`${cv.fileName}\``,
    );
    lines.push('');
    // Round 4 — coordonnées extraites. Si email manquant, on signale
    // explicitement « contact à retrouver » : le DRH sait qu'il faudra
    // arbitrer manuellement (pas d'envoi automatique possible).
    const contactBits: string[] = [];
    if (cv.email) contactBits.push(`Email : ${cv.email}`);
    else contactBits.push('Email : *manquant — contact à retrouver*');
    if (cv.phone) contactBits.push(`Téléphone : ${cv.phone}`);
    lines.push(contactBits.join('  · '));
    lines.push('');
    lines.push(`Expérience estimée : ${cv.experienceYears} an(s)`);
    if (cv.skills.length > 0) {
      lines.push(`Compétences : ${cv.skills.join(', ')}`);
    }
    lines.push('', cv.summary, '');

    if (cv.strengths.length > 0) {
      lines.push('### Points forts');
      for (const s of cv.strengths) lines.push(`- ${s}`);
      lines.push('');
    }
    if (cv.weaknesses.length > 0) {
      lines.push("### Points d'attention");
      for (const w of cv.weaknesses) lines.push(`- ${w}`);
      lines.push('');
    }
    lines.push('### Verdict', cv.justification, '');
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function buildCVBatchSummary(
  perCV: CVAnalysisResult[],
  threshold: number,
): CVBatchSummary {
  return {
    total: perCV.length,
    aboveThreshold: perCV.filter((c) => c.aboveThreshold).length,
    threshold,
    perCV,
  };
}

export function suggestCVReportFileName(campaignId: string | null): string {
  const id = campaignId ?? 'tasks';
  const stamp = new Date().toISOString().slice(0, 10);
  return `rapport-cv-${id}-${stamp}.md`;
}
