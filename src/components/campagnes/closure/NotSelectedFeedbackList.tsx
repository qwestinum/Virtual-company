'use client';

/**
 * Clôture — les retenus NON sélectionnés, chacun avec le choix OBLIGATOIRE de
 * message (gabarit « Non retenu », feat/feedback-candidat lot 4). Même panneau
 * que le verdict : envoyer le message relu, ou prévenir soi-même. Un par un,
 * jamais un envoi groupé : chacun a été reçu en entretien.
 */

import { FeedbackChoicePanel } from '@/components/feedback/FeedbackChoicePanel';
import type { ClosureRetenu } from '@/lib/candidatures/dismissal-batch';
import type { FeedbackChoice } from '@/types/candidate-feedback';

export function NotSelectedFeedbackList({
  candidates,
  feedbacks,
  disabled,
  onChange,
}: {
  candidates: readonly ClosureRetenu[];
  feedbacks: Readonly<Record<string, FeedbackChoice | null>>;
  disabled: boolean;
  onChange: (analysisId: string, choice: FeedbackChoice | null) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="mb-4 flex flex-col gap-3" data-role="closure-not-selected">
      <h4 className="font-display text-[13px] font-bold text-stone-800">
        Retenus non sélectionnés ({candidates.length})
      </h4>
      <p className="-mt-2 font-body text-[12px] text-stone-600">
        Ils passent en « Non retenu ». Pour chacun, choisissez comment il est informé.
      </p>
      {candidates.map((c) => (
        <div key={c.analysisId} className="flex flex-col gap-1.5">
          <p className="font-body text-[12.5px] font-semibold text-stone-800">
            {c.candidateName}
            {feedbacks[c.analysisId] ? (
              <span className="ml-2 font-normal text-emerald-700">✓ choix fait</span>
            ) : null}
          </p>
          <FeedbackChoicePanel
            analysisId={c.analysisId}
            kind="non_retenu"
            disabled={disabled}
            onChange={(choice) => onChange(c.analysisId, choice)}
          />
        </div>
      ))}
    </section>
  );
}
