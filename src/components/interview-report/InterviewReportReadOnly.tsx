'use client';

/**
 * Compte rendu d'entretien en LECTURE — le texte tel que validé, et la
 * mention (rendue des colonnes de vérification, jamais stockée en texte).
 */

import { interviewReportMention } from '@/lib/candidatures/interview-report-mention';
import type { InterviewReport } from '@/types/interview-report';

export function InterviewReportReadOnly({ report }: { report: InterviewReport }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-[11.5px] italic text-stone-500">
        {interviewReportMention(report)}
      </p>
      <p className="whitespace-pre-line rounded-lg border border-sky-100 bg-white px-3 py-2 font-body text-[13px] leading-relaxed text-stone-800">
        {report.sections.body}
      </p>
    </div>
  );
}
