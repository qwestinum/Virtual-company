'use client';

/**
 * Éditeur du compte rendu d'entretien — cinq rubriques, TOUTES facultatives.
 * Spec : docs/specs/compte-rendu-entretien.md §3.
 *
 * Un gabarit souple, pas un formulaire : chaque rubrique porte une phrase
 * d'aide en gris, les critères de la campagne servent de REPÈRES (un critère
 * non abordé reste vide, il n'est jamais marqué « non »). Le même éditeur
 * ouvre un compte rendu proposé à partir d'une transcription (lot 4) : seuls
 * les libellés changent, un compte rendu proposé restitue sans juger.
 */

import {
  sectionLabels,
  type InterviewReportSections,
  type InterviewReportSource,
} from '@/types/interview-report';

type FreeKey = 'topics' | 'highlights' | 'reservations' | 'followUps';

const HINTS: Record<FreeKey, string> = {
  topics: 'Parcours, motivations, projet, conditions (disponibilité, mobilité, rémunération)…',
  highlights: 'Ce qui ressort favorablement de l’échange.',
  reservations: 'Ce qui appelle une réserve, et pourquoi.',
  followUps: 'Références, point technique à creuser, pièce à fournir…',
};

export function InterviewReportEditor({
  sections,
  source,
  disabled,
  onChange,
}: {
  sections: InterviewReportSections;
  source: InterviewReportSource;
  disabled: boolean;
  onChange: (next: InterviewReportSections) => void;
}) {
  const labels = sectionLabels(source);
  const set = (key: FreeKey, value: string) => onChange({ ...sections, [key]: value });
  const setCriterion = (index: number, text: string) =>
    onChange({
      ...sections,
      criteria: sections.criteria.map((c, i) => (i === index ? { ...c, text } : c)),
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-[11.5px] text-stone-500">
        Ne consignez que ce qui a un lien direct avec le poste.
      </p>
      <Area label={labels.topics} hint={HINTS.topics} value={sections.topics} disabled={disabled} onChange={(v) => set('topics', v)} />

      {sections.criteria.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-body text-[12.5px] font-semibold text-stone-700">
            {labels.criteria}
          </legend>
          {sections.criteria.map((c, i) => (
            <Area
              key={c.criterionId}
              label={c.label}
              hint="Ce que le candidat en a dit — laisser vide si le sujet n’a pas été abordé."
              value={c.text}
              disabled={disabled}
              onChange={(v) => setCriterion(i, v)}
              compact
            />
          ))}
        </fieldset>
      ) : null}

      <Area label={labels.highlights} hint={HINTS.highlights} value={sections.highlights} disabled={disabled} onChange={(v) => set('highlights', v)} />
      <Area label={labels.reservations} hint={HINTS.reservations} value={sections.reservations} disabled={disabled} onChange={(v) => set('reservations', v)} />
      <Area label={labels.followUps} hint={HINTS.followUps} value={sections.followUps} disabled={disabled} onChange={(v) => set('followUps', v)} />
    </div>
  );
}

function Area({
  label,
  hint,
  value,
  disabled,
  onChange,
  compact = false,
}: {
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={`font-body text-stone-700 ${compact ? 'text-[12px]' : 'text-[12.5px] font-semibold'}`}>
        {label}
      </span>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={6000}
        placeholder={hint}
        className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 font-body text-[13px] text-stone-800 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none disabled:opacity-60"
      />
    </label>
  );
}
