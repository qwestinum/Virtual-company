'use client';

/**
 * Bouton « Corriger la décision ».
 *
 * Ne s'affiche QUE si une décision corrigible existe sur ce dossier. Le
 * prédicat est le MÊME que celui du serveur (`resolveCurrentDecision`) appliqué
 * à l'étape courante — pas une liste d'étapes recopiée à côté, qui divergerait
 * au premier changement de l'échelle.
 *
 * Sur `a_valider`, rien n'a été décidé : le bouton est absent. Sur une étape
 * terminale il REMPLACE le « consultation seule » — c'est précisément là qu'une
 * erreur se découvre.
 */

import { useState } from 'react';

import type { CandidateStage } from '@/lib/reporting/candidate-stage';

import { CorrectDecisionDialog } from './CorrectDecisionDialog';

/**
 * Une décision a-t-elle pu être posée à cette étape ? Prédicat CÔTÉ UI (le
 * serveur retranche : un dossier sans marqueur lisible rend `current: null` et
 * le dialog affiche « aucune décision à corriger »).
 */
export function hasCorrectableDecision(stage: CandidateStage): boolean {
  return stage !== 'a_valider';
}

export function CorrectDecisionAction({
  analysisId,
  candidateName,
  stage,
  onActed,
  variant = 'button',
  label,
}: {
  analysisId: string;
  candidateName: string;
  stage: CandidateStage;
  onActed: () => void;
  /** `link` = discret, pour une ligne de liste (Entretiens). */
  variant?: 'button' | 'link';
  /**
   * Libellé alternatif. Un classement sans suite se corrige en « Rouvrant » —
   * c'est le mot que le recruteur cherche, même si le mécanisme est le même.
   */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!hasCorrectableDecision(stage)) return null;

  const className =
    variant === 'link'
      ? 'font-body text-[12px] font-semibold text-stone-500 underline underline-offset-2 transition hover:text-stone-700'
      : 'rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 transition hover:bg-stone-50';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label ?? 'Corriger la décision'}
      </button>
      {open ? (
        <CorrectDecisionDialog
          analysisId={analysisId}
          candidateName={candidateName}
          onClose={() => setOpen(false)}
          onCorrected={() => {
            setOpen(false);
            onActed();
          }}
        />
      ) : null}
    </>
  );
}
