'use client';

/**
 * Clôture — issue du recrutement et désignation du recruté
 * (feat/feedback-candidat, lot 4).
 *
 * « Recruté » est une désignation HUMAINE explicite : aucun retenu n'est
 * pré-coché, et « ne pas préciser » reste un choix — on ne bloque jamais une
 * clôture. Désigner un recruté fait passer les AUTRES retenus en « Non
 * retenu » : l'écran le dit avant, pas après.
 */

import { useId } from 'react';

import {
  asksForHire,
  type ClosureDraft,
  type ClosureOutcome,
  type HiredChoice,
} from '@/lib/campagnes/closure-draft';
import type { ClosureRetenu } from '@/lib/candidatures/dismissal-batch';

export function ClosureOutcomeSection({
  draft,
  retenus,
  disabled,
  onOutcome,
  onHired,
}: {
  draft: ClosureDraft;
  retenus: readonly ClosureRetenu[];
  disabled: boolean;
  onOutcome: (outcome: ClosureOutcome) => void;
  onHired: (hired: HiredChoice) => void;
}) {
  const outcomeName = useId();
  const hiredName = useId();
  const hiredId = draft.hired?.kind === 'designated' ? draft.hired.analysisId : null;

  return (
    <section className="mb-4 flex flex-col gap-3" data-role="closure-outcome">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-display text-[13px] font-bold text-stone-800">
          Le recrutement est-il conclu ?
        </legend>
        <Radio
          name={outcomeName}
          checked={draft.outcome === 'conclu'}
          disabled={disabled}
          onChange={() => onOutcome('conclu')}
          label="Oui, recrutement conclu"
          data="conclu"
        />
        <Radio
          name={outcomeName}
          checked={draft.outcome === 'non_conclu'}
          disabled={disabled}
          onChange={() => onOutcome('non_conclu')}
          label="Non, clôture sans recrutement"
          data="non_conclu"
        />
      </fieldset>

      {asksForHire(draft, retenus) ? (
        <fieldset className="flex flex-col gap-1.5 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <legend className="px-1 font-display text-[13px] font-bold text-stone-800">
            Qui est recruté ?
          </legend>
          <p className="font-body text-[12px] text-stone-600">
            Parmi les candidats retenus. Les autres retenus passeront en « Non retenu », et
            vous choisirez comment les prévenir.
          </p>
          {retenus.map((r) => (
            <Radio
              key={r.analysisId}
              name={hiredName}
              checked={hiredId === r.analysisId}
              disabled={disabled}
              onChange={() => onHired({ kind: 'designated', analysisId: r.analysisId })}
              label={r.candidateName}
              data={`hire-${r.analysisId}`}
            />
          ))}
          <Radio
            name={hiredName}
            checked={draft.hired?.kind === 'unspecified'}
            disabled={disabled}
            onChange={() => onHired({ kind: 'unspecified' })}
            label="Ne pas préciser"
            detail="Les retenus restent « Retenu » ; aucun message n’est envoyé."
            data="hire-unspecified"
          />
        </fieldset>
      ) : null}
    </section>
  );
}

function Radio({
  name,
  checked,
  disabled,
  onChange,
  label,
  detail,
  data,
}: {
  name: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: string;
  detail?: string;
  data: string;
}) {
  return (
    <label className="flex items-start gap-2 font-body text-[12.5px] text-stone-800">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        data-closure-choice={data}
        className="mt-0.5"
      />
      <span>
        {label}
        {detail ? <span className="block text-[11.5px] text-stone-500">{detail}</span> : null}
      </span>
    </label>
  );
}
