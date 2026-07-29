'use client';

/**
 * Actions adaptées à l'étape, CENTRALISÉES. Rendu À L'IDENTIQUE au niveau 2
 * (panneau) ET au niveau 3 (page). Toutes les actions passent par la MÊME
 * mécanique sous-jacente — aucune divergence :
 *   - zone grise        → `ValidationCard` (→ `decideGrayValidation`)
 *   - invité / RDV pris → `markCandidateInterview`
 *   - entretien réalisé → `markCandidateValidation` (+ flux « poste pourvu »
 *     après un GO : proposer de classer les candidatures restantes)
 *   - toute étape OUVERTE → « Classer sans suite » (dialog motif)
 *   - sans suite         → mention terminale + « Rouvrir »
 *   - terminal           → aucune action (consultation seule)
 */

import { useState } from 'react';

import { CampaignDismissFlowDialog } from '@/components/campagnes/CampaignDismissFlowDialog';
import {
  markCandidateInterview,
  markCandidateValidation,
} from '@/lib/dashboard/candidate-actions';
import type { CandidateListItem } from '@/types/reporting';

import {
  DismissActionButton,
  DismissedBlock,
} from './CandidatureDismissAction';
import { GrayValidationAction } from './GrayValidationAction';
import { isTerminalStage } from './stage-ui';

export function CandidatureActions({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  if (item.stage === 'sans_suite') {
    return <DismissedBlock item={item} onActed={onActed} />;
  }
  if (item.stage === 'a_valider') {
    return (
      <div className="flex flex-col gap-2">
        <GrayValidationAction item={item} onActed={onActed} />
        <div>
          <DismissActionButton item={item} onActed={onActed} />
        </div>
      </div>
    );
  }
  if (item.stage === 'invite' || item.stage === 'rdv_pris') {
    return <InterviewMarkAction item={item} onActed={onActed} />;
  }
  if (item.stage === 'entretien_fait') {
    return <FinalDecisionAction item={item} onActed={onActed} />;
  }
  if (isTerminalStage(item.stage)) {
    return (
      <p className="font-body text-[12px] italic text-stone-400">
        Dossier clôturé — consultation seule.
      </p>
    );
  }
  return null;
}

function InterviewMarkAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mark = async (status: 'realized' | 'missed') => {
    if (busy) return;
    setBusy(true);
    try {
      await markCandidateInterview({
        uid: item.uid,
        candidateName: item.candidateName,
        campaignId: item.campaignId,
        status,
      });
      onActed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton tone="positive" disabled={busy} onClick={() => mark('realized')}>
        Entretien réalisé
      </ActionButton>
      <ActionButton tone="neutral" disabled={busy} onClick={() => mark('missed')}>
        Non réalisé
      </ActionButton>
      <DismissActionButton item={item} onActed={onActed} />
    </div>
  );
}

function FinalDecisionAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Flux « poste pourvu » (cas B validé) : après un GO, proposer de classer
  // les candidatures restantes de la campagne — NON bloquant (le GO est déjà
  // acté si l'utilisateur décline).
  const [goFollowUp, setGoFollowUp] = useState(false);

  const decide = async (status: 'validated' | 'rejected') => {
    if (busy) return;
    setBusy(true);
    try {
      await markCandidateValidation({
        uid: item.uid,
        candidateName: item.candidateName,
        campaignId: item.campaignId,
        status,
      });
      if (status === 'validated' && item.campaignId) {
        setGoFollowUp(true);
      } else {
        onActed();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="positive" disabled={busy} onClick={() => decide('validated')}>
          GO définitif
        </ActionButton>
        <ActionButton tone="negative" disabled={busy} onClick={() => decide('rejected')}>
          Non retenu
        </ActionButton>
        <DismissActionButton item={item} onActed={onActed} />
      </div>
      {goFollowUp && item.campaignId ? (
        <CampaignDismissFlowDialog
          campaignId={item.campaignId}
          mode="go"
          onCancel={() => {
            setGoFollowUp(false);
            onActed();
          }}
          onDone={() => {
            setGoFollowUp(false);
            onActed();
          }}
        />
      ) : null}
    </>
  );
}

function ActionButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: 'positive' | 'negative' | 'neutral';
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
      : tone === 'negative'
        ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
        : 'border-stone-300 text-stone-600 hover:bg-stone-50';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 font-body text-[12px] font-semibold transition disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
