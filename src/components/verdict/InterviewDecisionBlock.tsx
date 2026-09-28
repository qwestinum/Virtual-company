'use client';

/**
 * Bloc de DÉCISION d'une candidature en attente de verdict — un composant, deux
 * points d'affichage : l'onglet Entretiens (saisie principale) et la fiche
 * candidature. Spec : docs/specs/compte-rendu-entretien.md §14.2.
 *
 * Le champ est DEVANT la décision, pas derrière un clic : on peut écrire
 * pourquoi, puis on choisit. Le commentaire est FACULTATIF (arbitrage du
 * 19/09/2026) : les boutons ne dépendent pas de lui.
 *
 * Deux zones DISTINCTES, dans l'ordre demandé (§18) : 1. le commentaire
 * (ambre) — pourquoi on décide —, 2. le compte rendu (bleu) — ce qui s'est
 * passé —, puis la décision, séparée par un filet.
 *
 * Informer le candidat (feat/feedback-candidat, 28/09/2026) : choisir
 * « Retenir » ou « Ne pas retenir » ouvre le choix OBLIGATOIRE du message
 * (envoyer le gabarit relu, ou prévenir soi-même). Le bouton d'enregistrement
 * reste désarmé tant que ce choix est incomplet ; la route refuse de toute
 * façon un verdict sans lui. Le commentaire interne ne part jamais au
 * candidat.
 */

import { useId, useState } from 'react';

import { FeedbackChoicePanel } from '@/components/feedback/FeedbackChoicePanel';
import { InterviewReportPanel } from '@/components/interview-report/InterviewReportPanel';
import { feedbackKindForVerdict } from '@/lib/candidatures/feedback-choice';
import { postCandidateVerdict } from '@/lib/dashboard/candidate-actions';
import type { FeedbackChoice } from '@/types/candidate-feedback';
import type { FinalVerdict } from '@/types/verdict-comment';

import { VerdictCommentField } from './VerdictCommentField';

export function InterviewDecisionBlock({
  analysisId,
  candidateName,
  onDecided,
  onStale,
}: {
  analysisId: string;
  candidateName: string;
  /** `feedbackNotice` : ce qu'il est advenu du message au candidat, à afficher. */
  onDecided: (verdict: FinalVerdict, feedbackNotice: string) => void;
  /** Le dossier a bougé ailleurs (409) : l'hôte recharge. */
  onStale: () => void;
}) {
  const fieldId = useId();
  const [comment, setComment] = useState('');
  const [verdict, setVerdict] = useState<FinalVerdict | null>(null);
  const [feedback, setFeedback] = useState<FeedbackChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(next: FinalVerdict) {
    if (next === verdict) return;
    setVerdict(next);
    // Un autre verdict = un autre message : le choix repart de zéro.
    setFeedback(null);
  }

  async function confirm() {
    if (busy || !verdict || !feedback) return;
    setBusy(true);
    setError(null);
    const result = await postCandidateVerdict({
      analysisId,
      candidateName,
      status: verdict,
      comment,
      feedback,
    });
    setBusy(false);
    if (result.ok) {
      onDecided(verdict, result.feedbackNotice);
      return;
    }
    // Le commentaire et le message RESTENT : un échec ne coûte jamais le texte.
    setError(result.message);
    if (result.reload) onStale();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3">
      <VerdictCommentField
        id={fieldId}
        value={comment}
        onChange={setComment}
        disabled={busy}
        step={1}
      />
      <InterviewReportPanel analysisId={analysisId} step={2} />
      {/* La décision, séparée des deux zones de saisie. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
        <span className="font-display text-[13px] font-bold text-stone-800">Votre décision :</span>
        <DecisionButton
          verdict="validated"
          selected={verdict === 'validated'}
          disabled={busy}
          onClick={() => pick('validated')}
        >
          ✓ Retenir
        </DecisionButton>
        <DecisionButton
          verdict="rejected"
          selected={verdict === 'rejected'}
          disabled={busy}
          onClick={() => pick('rejected')}
        >
          ✗ Ne pas retenir
        </DecisionButton>
      </div>
      {verdict ? (
        <FeedbackChoicePanel
          key={verdict}
          analysisId={analysisId}
          kind={feedbackKindForVerdict(verdict)}
          disabled={busy}
          onChange={setFeedback}
        />
      ) : null}
      {error ? (
        <p role="alert" className="font-body text-[12.5px] text-rose-700">
          {error}
        </p>
      ) : null}
      {verdict ? (
        <div className="flex justify-end">
          {/* Le libellé dit que le clic ENREGISTRE — la décision, le
              commentaire s'il y en a un, et le message au candidat. */}
          <button
            type="button"
            data-role="confirm-verdict"
            disabled={busy || !feedback}
            onClick={() => void confirm()}
            className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? 'Enregistrement…'
              : verdict === 'validated'
                ? 'Retenir et enregistrer'
                : 'Ne pas retenir et enregistrer'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DecisionButton({
  verdict,
  selected,
  disabled,
  onClick,
  children,
}: {
  /** Repère STABLE pour les tests qui cliquent — le libellé, lui, bouge. */
  verdict: FinalVerdict;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    verdict === 'validated'
      ? selected
        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
        : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
      : selected
        ? 'border-rose-600 bg-rose-50 text-rose-800'
        : 'border-rose-300 text-rose-700 hover:bg-rose-50';
  return (
    <button
      type="button"
      data-verdict={verdict}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border bg-white px-3 py-1.5 font-body text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
