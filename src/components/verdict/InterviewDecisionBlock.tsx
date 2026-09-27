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
 */

import { useId, useState } from 'react';

import { InterviewReportPanel } from '@/components/interview-report/InterviewReportPanel';
import { postCandidateVerdict } from '@/lib/dashboard/candidate-actions';
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
  onDecided: (verdict: FinalVerdict) => void;
  /** Le dossier a bougé ailleurs (409) : l'hôte recharge. */
  onStale: () => void;
}) {
  const fieldId = useId();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<FinalVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(verdict: FinalVerdict) {
    if (busy) return;
    setBusy(verdict);
    setError(null);
    const result = await postCandidateVerdict({
      analysisId,
      candidateName,
      status: verdict,
      comment,
    });
    setBusy(null);
    if (result.ok) {
      onDecided(verdict);
      return;
    }
    // Le commentaire RESTE dans le champ : un échec ne doit jamais coûter le
    // texte écrit.
    setError(result.message);
    if (result.reload) onStale();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3">
      <VerdictCommentField
        id={fieldId}
        value={comment}
        onChange={setComment}
        disabled={busy !== null}
        step={1}
      />
      <InterviewReportPanel analysisId={analysisId} step={2} />
      {error ? (
        <p role="alert" className="font-body text-[12.5px] text-rose-700">
          {error}
        </p>
      ) : null}
      {/* La décision, séparée des deux zones de saisie. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
        <span className="font-display text-[13px] font-bold text-stone-800">Votre décision :</span>
        {/* Le libellé dit que le clic ENREGISTRE — la décision et, s'il y en
            a un, le commentaire au-dessus. */}
        <DecisionButton
          verdict="validated"
          disabled={busy !== null}
          onClick={() => void decide('validated')}
        >
          {busy === 'validated' ? 'Enregistrement…' : '✓ Retenir et enregistrer'}
        </DecisionButton>
        <DecisionButton
          verdict="rejected"
          disabled={busy !== null}
          onClick={() => void decide('rejected')}
        >
          {busy === 'rejected' ? 'Enregistrement…' : '✗ Ne pas retenir et enregistrer'}
        </DecisionButton>
      </div>
    </div>
  );
}

function DecisionButton({
  verdict,
  disabled,
  onClick,
  children,
}: {
  /** Repère STABLE pour les tests qui cliquent — le libellé, lui, bouge. */
  verdict: FinalVerdict;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    verdict === 'validated'
      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
      : 'border-rose-300 text-rose-700 hover:bg-rose-50';
  return (
    <button
      type="button"
      data-verdict={verdict}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border bg-white px-3 py-1.5 font-body text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
