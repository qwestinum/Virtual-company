'use client';

/**
 * Clôture — les candidatures encore OUVERTES (à valider, propositions de
 * refus, invités, RDV pris, entretiens faits). Classement sans suite GROUPÉ,
 * comme avant ; le motif se DÉDUIT de l'issue (conclu ⇒ poste pourvu, sinon
 * campagne clôturée) et le message part sur le gabarit « Sans suite » des
 * Réglages — ce n'est pas un refus.
 */

import { closureDismissalReason, type ClosureDraft } from '@/lib/campagnes/closure-draft';
import type { OpenCandidaturesRecap } from '@/lib/candidatures/dismissal-batch';
import {
  CANDIDATE_STAGE_LABELS,
  OPEN_CANDIDATE_STAGES,
} from '@/lib/reporting/candidate-stage';

export function ClosureOpenSection({
  recap,
  draft,
  disabled,
  onChange,
}: {
  recap: OpenCandidaturesRecap;
  draft: ClosureDraft;
  disabled: boolean;
  onChange: (next: ClosureDraft) => void;
}) {
  if (recap.total === 0) {
    return (
      <p className="mb-4 font-body text-[13px] text-stone-600">
        Aucune candidature en cours : les agents arrêteront tout traitement automatique.
      </p>
    );
  }
  const detail = OPEN_CANDIDATE_STAGES.filter((s) => (recap.counts[s] ?? 0) > 0)
    .map((s) => `${recap.counts[s]} ${CANDIDATE_STAGE_LABELS[s].toLowerCase()}`)
    .join(' · ');
  const motif =
    draft.outcome === null
      ? null
      : closureDismissalReason(draft.outcome) === 'poste_pourvu'
        ? 'poste pourvu'
        : 'campagne clôturée sans recrutement';

  return (
    <section className="mb-4 flex flex-col gap-2" data-role="closure-open">
      <h4 className="font-display text-[13px] font-bold text-stone-800">
        {recap.total} candidature{recap.total > 1 ? 's' : ''} en cours
      </h4>
      <p className="-mt-1 font-body text-[12px] text-stone-600">{detail}.</p>
      <label className="flex items-start gap-2 font-body text-[12.5px] text-stone-700">
        <input
          type="checkbox"
          checked={draft.dismissOpen}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, dismissOpen: e.currentTarget.checked })}
          className="mt-0.5"
        />
        <span>
          Les classer sans suite{motif ? ` (motif : ${motif})` : ''} — ce n’est pas un refus,
          aucune évaluation n’est posée.
        </span>
      </label>
      {draft.dismissOpen ? (
        <label className="flex items-start gap-2 pl-6 font-body text-[12.5px] text-stone-700">
          <input
            type="checkbox"
            checked={draft.sendMail}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, sendMail: e.currentTarget.checked })}
            className="mt-0.5"
          />
          <span>Les informer par email (message « Sans suite » des Réglages).</span>
        </label>
      ) : null}
    </section>
  );
}
