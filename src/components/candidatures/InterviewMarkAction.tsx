'use client';

/**
 * Invité / RDV pris : pointer l'entretien. « Entretien réalisé » est un
 * CONSTAT (marquage ordinaire) ; « Non réalisé » ouvre le dialog d'absence —
 * classer non retenu y exige le message au candidat (feat/feedback-candidat),
 * re-proposer un créneau ne décide rien.
 */

import { useState } from 'react';

import { NoShowDialog } from '@/components/interviews/NoShowDialog';
import { markCandidateInterview } from '@/lib/dashboard/candidate-actions';
import type { CandidateListItem } from '@/types/reporting';

import { ActionButton, CorrectionButton } from './CandidatureActionButtons';
import { DismissActionButton } from './CandidatureDismissAction';

export function InterviewMarkAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // « Non réalisé » est une DÉCISION (l'absence dérive vers « Non retenu ») :
  // le dialog d'absence d'abord, avec le message au candidat — jamais un
  // marquage en un clic.
  const [noShow, setNoShow] = useState(false);
  const markRealized = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markCandidateInterview({
        uid: item.uid,
        candidateName: item.candidateName,
        campaignId: item.campaignId,
        status: 'realized',
      });
      onActed();
    } finally {
      setBusy(false);
    }
  };
  const reinvite = async () => {
    setBusy(true);
    try {
      await fetch('/api/interviews/reissue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: item.id, kind: 'reinvite' }),
      });
    } finally {
      setBusy(false);
      setNoShow(false);
      onActed();
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton tone="positive" disabled={busy} onClick={() => void markRealized()}>
        Entretien réalisé
      </ActionButton>
      <ActionButton tone="neutral" disabled={busy} onClick={() => setNoShow(true)}>
        Non réalisé
      </ActionButton>
      <DismissActionButton item={item} onActed={onActed} />
      <CorrectionButton item={item} onActed={onActed} />
      {noShow ? (
        <NoShowDialog
          analysisId={item.id}
          candidateName={item.candidateName}
          busy={busy}
          onCancel={() => setNoShow(false)}
          onReinvite={() => void reinvite()}
          onRejected={() => {
            setNoShow(false);
            onActed();
          }}
        />
      ) : null}
    </div>
  );
}
