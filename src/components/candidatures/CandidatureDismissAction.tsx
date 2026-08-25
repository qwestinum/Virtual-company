'use client';

/**
 * Volet « sans suite » des actions candidature :
 *   - étapes OUVERTES → bouton discret « Classer sans suite » (dialog motif) ;
 *   - étape `sans_suite` → mention terminale (motif) + « Rouvrir », qui passe
 *     par le dialog de CORRECTION partagé : un classement posé par erreur est
 *     une décision comme une autre, et le dialog dit ce qui est déjà parti
 *     (un mail d'information ne se dé-envoie pas) avant de confirmer.
 * Extrait de CandidatureActions (limite 200 lignes/fichier).
 */

import { useState } from 'react';

import { DISMISSAL_REASON_LABELS } from '@/types/dismissal';
import type { CandidateListItem } from '@/types/reporting';

import { CandidatureDismissDialog } from './CandidatureDismissDialog';
import { CorrectDecisionAction } from './CorrectDecisionAction';

/** Bouton + dialog pour une candidature OUVERTE. */
export function DismissActionButton({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-500 transition hover:bg-stone-50"
      >
        Classer sans suite
      </button>
      {open ? (
        <CandidatureDismissDialog
          item={item}
          onClose={() => setOpen(false)}
          onDismissed={() => {
            setOpen(false);
            onActed();
          }}
        />
      ) : null}
    </>
  );
}

/** Bloc terminal d'une candidature classée : motif + réouverture. */
export function DismissedBlock({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-[12px] italic text-stone-500">
        Classée sans suite
        {item.dismissalReason
          ? ` — ${DISMISSAL_REASON_LABELS[item.dismissalReason].toLowerCase()}`
          : ''}
        . Ce n&apos;est pas un refus : la candidature n&apos;a pas été évaluée
        jusqu&apos;au bout.
      </p>
      <div>
        {/* Plus de `window.confirm` : la réouverture passe par le dialog
            partagé, qui AFFICHE d'abord ce qui a déjà été déclenché. */}
        <CorrectDecisionAction
          analysisId={item.id}
          candidateName={item.candidateName}
          stage={item.stage}
          onActed={onActed}
          label="Rouvrir la candidature"
        />
      </div>
    </div>
  );
}
