'use client';

/**
 * Compte rendu d'entretien en LECTURE — rubriques non vides seulement, et la
 * mention (rendue des colonnes de vérification, jamais stockée en texte).
 */

import { interviewReportMention } from '@/lib/candidatures/interview-report-mention';
import { sectionLabels, type InterviewReport } from '@/types/interview-report';

export function InterviewReportReadOnly({ report }: { report: InterviewReport }) {
  const labels = sectionLabels(report.source);
  const { sections } = report;
  const criteria = sections.criteria.filter((c) => c.text.trim() !== '');
  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-[11.5px] italic text-stone-500">
        {interviewReportMention(report)}
      </p>
      <Block label={labels.topics} text={sections.topics} />
      {criteria.length > 0 ? (
        <div>
          <p className="font-body text-[12px] font-semibold text-stone-700">{labels.criteria}</p>
          <ul className="mt-0.5 flex flex-col gap-1">
            {criteria.map((c) => (
              <li key={c.criterionId} className="font-body text-[12.5px] text-stone-800">
                <span className="font-semibold">{c.label} — </span>
                <span className="whitespace-pre-line">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Block label={labels.highlights} text={sections.highlights} />
      <Block label={labels.reservations} text={sections.reservations} />
      <Block label={labels.followUps} text={sections.followUps} />
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  if (text.trim() === '') return null;
  return (
    <div>
      <p className="font-body text-[12px] font-semibold text-stone-700">{label}</p>
      <p className="whitespace-pre-line font-body text-[12.5px] text-stone-800">{text}</p>
    </div>
  );
}
