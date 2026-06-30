'use client';

/**
 * Actions adaptées à l'étape, CENTRALISÉES. Rendu À L'IDENTIQUE au niveau 2
 * (panneau) ET au niveau 3 (page). Toutes les actions passent par la MÊME
 * mécanique sous-jacente — aucune divergence :
 *   - zone grise        → `ValidationCard` (→ `decideGrayValidation`)
 *   - invité / RDV pris → `markCandidateInterview`
 *   - entretien réalisé → `markCandidateValidation`
 *   - terminal          → aucune action (consultation seule)
 */

import { useEffect, useState } from 'react';

import { ValidationCard } from '@/components/validations/ValidationCard';
import {
  markCandidateInterview,
  markCandidateValidation,
} from '@/lib/dashboard/candidate-actions';
import type { PendingValidation } from '@/types/hitl';
import type { CandidateListItem } from '@/types/reporting';

import { isTerminalStage } from './stage-ui';

export function CandidatureActions({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  if (item.stage === 'a_valider') {
    return <GrayValidationAction item={item} onActed={onActed} />;
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

/** Gris : on retrouve la validation suspendue par uid et on rend la carte partagée. */
function GrayValidationAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [validation, setValidation] = useState<PendingValidation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { validations?: PendingValidation[] };
        const match =
          json.validations?.find(
            (v) =>
              typeof v.payload?.uid === 'string' && v.payload.uid === item.uid,
          ) ?? null;
        if (!cancelled) setValidation(match);
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.uid]);

  if (loading) {
    return (
      <p className="font-body text-[12px] text-stone-400">
        Chargement de la validation…
      </p>
    );
  }
  if (!validation) {
    return (
      <p className="font-body text-[12px] italic text-stone-400">
        Validation introuvable (déjà traitée ?).
      </p>
    );
  }
  return <ValidationCard v={validation} onSent={() => onActed()} />;
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
      onActed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton tone="positive" disabled={busy} onClick={() => decide('validated')}>
        GO définitif
      </ActionButton>
      <ActionButton tone="negative" disabled={busy} onClick={() => decide('rejected')}>
        Non retenu
      </ActionButton>
    </div>
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
