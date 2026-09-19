'use client';

/**
 * Éditeur du compte rendu d'entretien — UN SEUL champ libre (spec §18).
 *
 * Les repères (sujets abordés, critères de la campagne, points forts, réserves,
 * à vérifier) sont dans le texte d'aide : on écrit d'un tenant, sans case à
 * remplir. Un compte rendu proposé à partir d'une transcription arrive dans ce
 * même champ, organisé par intertitres, et se corrige comme un texte.
 */

import {
  MAX_REPORT_CHARS,
  reportPlaceholder,
  type InterviewReportSections,
  type ReportCriterionPrompt,
} from '@/types/interview-report';

export function InterviewReportEditor({
  sections,
  criteria,
  disabled,
  onChange,
}: {
  sections: InterviewReportSections;
  criteria: ReportCriterionPrompt[];
  disabled: boolean;
  onChange: (next: InterviewReportSections) => void;
}) {
  return (
    <textarea
      aria-label="Compte rendu d’entretien"
      value={sections.body}
      disabled={disabled}
      onChange={(e) => onChange({ version: 2, body: e.target.value })}
      rows={8}
      maxLength={MAX_REPORT_CHARS}
      placeholder={reportPlaceholder(criteria)}
      className="w-full resize-y rounded-lg border border-sky-200 bg-white px-3 py-2 font-body text-[13px] leading-relaxed text-stone-800 placeholder:text-stone-400 focus:border-sky-500 focus:outline-none disabled:opacity-60"
    />
  );
}
