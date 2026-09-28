'use client';

/**
 * Aperçu ÉDITABLE du message au candidat — ce qui est à l'écran est ce qui
 * part (le serveur n'y ajoute que la mention d'information, montrée ici en
 * lecture seule). Le commentaire interne n'y figure pas ; s'il y est collé,
 * l'envoi est refusé.
 */

import { useId } from 'react';

import {
  draftPlaceholders,
  editBody,
  resetBody,
  setNextStep,
  type FeedbackDraft,
} from '@/lib/candidatures/feedback-draft';
import type { FeedbackKind, FeedbackProposal } from '@/types/candidate-feedback';

const FIELD =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 focus:border-emerald-500 focus:outline-none disabled:opacity-60';

export function FeedbackMessageEditor({
  kind,
  draft,
  proposal,
  disabled,
  onChange,
}: {
  kind: FeedbackKind;
  draft: FeedbackDraft;
  proposal: FeedbackProposal;
  disabled: boolean;
  onChange: (next: FeedbackDraft) => void;
}) {
  const ids = { next: useId(), subject: useId(), body: useId() };
  const placeholders = draftPlaceholders(draft);

  return (
    <div className="ml-6 flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3">
      <p className="font-body text-[12px] text-stone-600">
        À : <strong className="text-stone-800">{proposal.candidateEmail}</strong>
        {proposal.replyTo ? <> · les réponses arrivent à {proposal.replyTo}</> : null}
      </p>

      {kind === 'retenu' ? (
        <label htmlFor={ids.next} className="flex flex-col gap-1">
          <span className="font-body text-[12px] font-semibold text-stone-700">
            Prochaine étape (facultatif)
          </span>
          <input
            id={ids.next}
            type="text"
            value={draft.nextStep}
            disabled={disabled}
            maxLength={500}
            placeholder="Ex. : vous rencontrerez notre client la semaine prochaine."
            onChange={(e) => onChange(setNextStep(draft, e.target.value, proposal))}
            className={FIELD}
          />
        </label>
      ) : null}

      <label htmlFor={ids.subject} className="flex flex-col gap-1">
        <span className="font-body text-[12px] font-semibold text-stone-700">Objet</span>
        <input
          id={ids.subject}
          type="text"
          value={draft.subject}
          disabled={disabled}
          maxLength={300}
          onChange={(e) => onChange({ ...draft, subject: e.target.value })}
          className={FIELD}
        />
      </label>

      <label htmlFor={ids.body} className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-body text-[12px] font-semibold text-stone-700">Message</span>
          {draft.bodyEdited ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(resetBody(draft, proposal))}
              className="font-body text-[11px] font-semibold text-stone-500 underline hover:text-stone-800"
            >
              Revenir au texte proposé
            </button>
          ) : null}
        </span>
        <textarea
          id={ids.body}
          data-role="feedback-body"
          value={draft.body}
          disabled={disabled}
          rows={10}
          maxLength={8000}
          onChange={(e) => onChange(editBody(draft, e.target.value))}
          className={`${FIELD} resize-y`}
        />
      </label>

      {placeholders.length > 0 ? (
        <p role="alert" className="font-body text-[12px] text-rose-700">
          À compléter avant l’envoi : {placeholders.join(', ')}.
        </p>
      ) : null}

      <p className="border-t border-stone-100 pt-2 font-body text-[11.5px] text-stone-500">
        Ajouté en pied : {proposal.rgpdFooter}
      </p>
    </div>
  );
}
