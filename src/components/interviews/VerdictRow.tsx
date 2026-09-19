'use client';

/**
 * Ligne « en attente de verdict » de l'onglet Entretiens — extraite de
 * `ScheduledList` (limite de 200 lignes). Spec :
 * docs/specs/compte-rendu-entretien.md §14.2.
 *
 * La ligne se DÉPLIE : le champ du commentaire (facultatif) est devant la
 * décision, pour qu'on puisse dire pourquoi au moment où l'on décide.
 */

import { CorrectDecisionAction } from '@/components/candidatures/CorrectDecisionAction';
import { InterviewDecisionBlock } from '@/components/verdict/InterviewDecisionBlock';
import type { FinalVerdict } from '@/types/verdict-comment';

import { Action } from './interview-row-ui';
import type { ScheduledItem } from './ScheduledList';

export function VerdictRowActions({
  row,
  open,
  onToggle,
  onCorrected,
}: {
  row: ScheduledItem;
  open: boolean;
  onToggle: () => void;
  onCorrected: () => void;
}) {
  return (
    <>
      <Action disabled={!row.analysisId} tone="positive" onClick={onToggle}>
        {open ? 'Replier' : 'Décider'}
      </Action>
      {/* Le pointage « entretien réalisé » EST une décision, et c'est ici
          qu'on la voit : elle se corrige donc ici. */}
      {row.analysisId && row.stage === 'entretien_fait' ? (
        <CorrectDecisionAction
          analysisId={row.analysisId}
          candidateName={row.candidateName}
          stage="entretien_fait"
          variant="link"
          onActed={onCorrected}
        />
      ) : null}
    </>
  );
}

export function VerdictExpansion({
  row,
  onDecided,
  onStale,
}: {
  row: ScheduledItem;
  onDecided: (verdict: FinalVerdict) => void;
  onStale: () => void;
}) {
  if (!row.analysisId) return null;
  return (
    <div className="basis-full">
      <InterviewDecisionBlock
        analysisId={row.analysisId}
        candidateName={row.candidateName}
        onDecided={onDecided}
        onStale={onStale}
      />
    </div>
  );
}
