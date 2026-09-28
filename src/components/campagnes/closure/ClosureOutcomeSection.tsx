'use client';

/**
 * Clôture — issue du recrutement et désignation des recrutés
 * (feat/feedback-candidat, lot 4 ; plusieurs recrutés, 28/09/2026).
 *
 * « Recruté » est une désignation HUMAINE explicite : aucun retenu n'est
 * pré-coché — des CASES, parce qu'une campagne peut aboutir à plusieurs
 * recrutements. « Ne pas préciser » reste un choix, exclusif — on ne bloque
 * jamais une clôture. Désigner des recrutés fait passer les AUTRES retenus en
 * « Non retenu » : l'écran le dit avant, pas après.
 */

import { useId } from 'react';

import {
  asksForHire,
  hiredIds,
  toggleHired,
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
  onHired: (hired: HiredChoice | null) => void;
}) {
  const outcomeName = useId();
  const checked = new Set(hiredIds(draft));

  return (
    <section className="mb-4 flex flex-col gap-3" data-role="closure-outcome">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-display text-[13px] font-bold text-stone-800">
          Le recrutement est-il conclu ?
        </legend>
        <Choice
          type="radio"
          name={outcomeName}
          checked={draft.outcome === 'conclu'}
          disabled={disabled}
          onChange={() => onOutcome('conclu')}
          label="Oui, recrutement conclu"
          data="conclu"
        />
        <Choice
          type="radio"
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
            Parmi les candidats retenus — cochez-en autant que de recrutements. Les
            autres retenus passeront en « Non retenu », et vous choisirez comment les
            prévenir.
          </p>
          {retenus.map((r) => (
            <Choice
              key={r.analysisId}
              type="checkbox"
              checked={checked.has(r.analysisId)}
              disabled={disabled}
              onChange={() => onHired(toggleHired(draft.hired, r.analysisId))}
              label={r.candidateName}
              data={`hire-${r.analysisId}`}
            />
          ))}
          <Choice
            type="checkbox"
            checked={draft.hired?.kind === 'unspecified'}
            disabled={disabled}
            onChange={() => onHired(draft.hired?.kind === 'unspecified' ? null : { kind: 'unspecified' })}
            label="Ne pas préciser"
            detail="Les retenus restent « Retenu » ; aucun message n’est envoyé."
            data="hire-unspecified"
          />
        </fieldset>
      ) : null}
    </section>
  );
}

function Choice({
  type,
  name,
  checked,
  disabled,
  onChange,
  label,
  detail,
  data,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
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
        type={type}
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
