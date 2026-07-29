'use client';

/**
 * Volet « sans suite » des actions candidature :
 *   - étapes OUVERTES → bouton discret « Classer sans suite » (dialog motif) ;
 *   - étape `sans_suite` → mention terminale (motif) + « Rouvrir » (rappel :
 *     un mail d'information déjà parti ne se dé-envoie pas).
 * Extrait de CandidatureActions (limite 200 lignes/fichier).
 */

import { useState } from 'react';

import { DISMISSAL_REASON_LABELS } from '@/types/dismissal';
import type { CandidateListItem } from '@/types/reporting';

import { CandidatureDismissDialog } from './CandidatureDismissDialog';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    if (busy) return;
    if (
      !window.confirm(
        'Rouvrir cette candidature ? Elle reprendra son étape antérieure. ' +
          'Si un mail d’information a été envoyé au candidat, il ne peut pas être annulé.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/candidatures/${encodeURIComponent(item.id)}/reopen`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(`La réouverture a échoué (HTTP ${res.status}).`);
        return;
      }
      onActed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setBusy(false);
    }
  }

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
      {error ? (
        <p className="font-body text-[12px] text-rose-600">{error}</p>
      ) : null}
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={reopen}
          className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
        >
          Rouvrir la candidature
        </button>
      </div>
    </div>
  );
}
