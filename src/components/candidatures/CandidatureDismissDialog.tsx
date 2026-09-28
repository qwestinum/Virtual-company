'use client';

/**
 * Dialog « Classer sans suite » (action INDIVIDUELLE, panneau/page candidat).
 * Raison typée obligatoire (individuelles uniquement — les raisons campagne
 * passent par les flux clôture/GO). Pour une raison qui appelle un message
 * (DISMISSAL_MAIL_POLICY ≠ 'never'), le choix « Informer le candidat » est
 * OBLIGATOIRE (feat/feedback-candidat) : gabarit « sans suite » relu, ou
 * « je préviens moi-même ». Doublon / invalide : aucun message, aucun choix.
 */

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

import { FeedbackChoicePanel } from '@/components/feedback/FeedbackChoicePanel';
import { postDecisionWithFeedback } from '@/lib/dashboard/candidate-actions';
import type { FeedbackChoice } from '@/types/candidate-feedback';
import {
  dismissalMailAllowed,
  DISMISSAL_REASON_LABELS,
  INDIVIDUAL_DISMISSAL_REASONS,
  type DismissalReason,
} from '@/types/dismissal';
/**
 * Ce dont le dialog a RÉELLEMENT besoin — pas une ligne de liste complète.
 * `CandidateListItem` satisfait cette forme, donc les appels existants ne
 * changent pas ; et la page Entretiens peut réutiliser LE dialog au lieu d'en
 * écrire un second qui divergerait au premier changement de matrice de mails.
 */
export type DismissableCandidature = {
  /** Identifiant d'ANALYSE — la clé de la route de classement. */
  id: string;
  candidateName: string;
  candidateEmail: string | null;
};

export function CandidatureDismissDialog({
  item,
  onClose,
  onDismissed,
}: {
  item: DismissableCandidature;
  onClose: () => void;
  /** `notice` : issue du message au candidat (vide sans message). */
  onDismissed: (notice: string) => void;
}) {
  const [reason, setReason] = useState<DismissalReason>('sans_reponse');
  const [feedback, setFeedback] = useState<FeedbackChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsMessage = dismissalMailAllowed(reason);
  const ready = !needsMessage || feedback !== null;

  function pickReason(next: DismissalReason) {
    setReason(next);
    // Une autre raison = un autre [motif] : le choix repart de zéro.
    setFeedback(null);
  }

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await postDecisionWithFeedback(
      `/api/candidatures/${encodeURIComponent(item.id)}/dismiss`,
      needsMessage ? { reason, feedback } : { reason },
    );
    setBusy(false);
    if (result.ok) onDismissed(needsMessage ? result.feedbackNotice : '');
    else setError(result.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-display text-[16px] font-bold text-stone-900">
            Classer sans suite
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mb-4 font-body text-[13px] text-stone-600">
          La candidature de <strong>{item.candidateName}</strong> sera clôturée
          sans décision d&apos;évaluation — ce n&apos;est pas un refus. Elle
          reste visible et consultable, et peut être rouverte en cas
          d&apos;erreur.
        </p>
        <label className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Motif
        </label>
        <select
          value={reason}
          onChange={(e) => pickReason(e.currentTarget.value as DismissalReason)}
          className="mb-3 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
        >
          {INDIVIDUAL_DISMISSAL_REASONS.map((r) => (
            <option key={r} value={r}>
              {DISMISSAL_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        {needsMessage ? (
          <div className="mb-4">
            <FeedbackChoicePanel
              key={reason}
              analysisId={item.id}
              kind="sans_suite"
              reason={reason}
              disabled={busy}
              onChange={setFeedback}
            />
          </div>
        ) : (
          <p className="mb-4 font-body text-[12px] text-stone-500">
            Aucun message n’est envoyé pour ce motif.
          </p>
        )}
        {error ? (
          <p className="mb-3 font-body text-[12px] text-rose-600">{error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || !ready}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-700 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Classer sans suite
          </button>
        </div>
      </div>
    </div>
  );
}
