'use client';

/**
 * « Je préviens moi-même » — le canal est déclaré et tracé ; aucune copie de
 * l'échange n'est demandée ni conservée.
 */

import { useId } from 'react';

import type { FeedbackDraft } from '@/lib/candidatures/feedback-draft';
import {
  FEEDBACK_CHANNEL_LABELS,
  SELF_FEEDBACK_CHANNELS,
} from '@/types/candidate-feedback';

export function FeedbackSelfChannel({
  draft,
  disabled,
  onChange,
}: {
  draft: FeedbackDraft;
  disabled: boolean;
  onChange: (next: FeedbackDraft) => void;
}) {
  const name = useId();
  const noteId = useId();
  return (
    <div className="ml-6 flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 font-body text-[12px] font-semibold text-stone-700">Par quel canal ?</legend>
        {SELF_FEEDBACK_CHANNELS.map((channel) => (
          <label key={channel} className="flex items-center gap-1.5 font-body text-[13px] text-stone-800">
            <input
              type="radio"
              name={name}
              value={channel}
              data-feedback-channel={channel}
              checked={draft.channel === channel}
              disabled={disabled}
              onChange={() => onChange({ ...draft, channel })}
            />
            {FEEDBACK_CHANNEL_LABELS[channel]}
          </label>
        ))}
      </fieldset>
      {draft.channel === 'autre' ? (
        <label htmlFor={noteId} className="flex flex-col gap-1">
          <span className="font-body text-[12px] font-semibold text-stone-700">Lequel ?</span>
          <input
            id={noteId}
            type="text"
            value={draft.note}
            disabled={disabled}
            maxLength={200}
            placeholder="Ex. : message LinkedIn, rencontre sur place"
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 focus:border-emerald-500 focus:outline-none"
          />
        </label>
      ) : null}
    </div>
  );
}
