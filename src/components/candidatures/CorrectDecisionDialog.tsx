'use client';

/**
 * Dialog de correction d'une décision — OBLIGATOIRE, jamais d'action en un clic.
 *
 * Ordre d'affichage volontaire : l'état actuel, puis CE QUI A DÉJÀ ÉTÉ
 * DÉCLENCHÉ (en évidence), puis seulement le nouvel état. On lit ce qu'on ne
 * peut plus défaire AVANT de choisir — l'inverse invite à confirmer d'abord et
 * à découvrir ensuite.
 *
 * Aucun envoi n'est déclenché par ce chemin, quel que soit l'état choisi : les
 * `notices` du contexte le rappellent sous les options.
 */

import { useEffect, useState } from 'react';

import type {
  CorrectionTarget,
  DecisionCorrectionContext,
} from '@/types/decision-correction';

import {
  CurrentDecisionBlock,
  SideEffectsBlock,
  TargetChoices,
} from './CorrectDecisionBlocks';

export function CorrectDecisionDialog({
  analysisId,
  candidateName,
  onClose,
  onCorrected,
}: {
  analysisId: string;
  candidateName: string;
  onClose: () => void;
  onCorrected: () => void;
}) {
  const [context, setContext] = useState<DecisionCorrectionContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<CorrectionTarget | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/candidatures/${encodeURIComponent(analysisId)}/correction-context`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const json = (await res.json()) as DecisionCorrectionContext;
        if (cancelled) return;
        setContext(json);
        setTarget(json.options[0]?.target ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  async function submit() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/candidatures/${encodeURIComponent(analysisId)}/correct-decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target, reason: reason.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // 409 = l'état a bougé sous les pieds de l'utilisateur : on ne propose
        // pas de « réessayer », on demande un rechargement.
        setError(
          data.error === 'not_correctable' || data.error === 'invalid_target'
            ? 'L’état de ce dossier a changé entre-temps. Rechargez la liste.'
            : `La correction a échoué (HTTP ${res.status}).`,
        );
        return;
      }
      onCorrected();
    } catch {
      setError('Erreur réseau — rien n’a été corrigé.');
    } finally {
      setBusy(false);
    }
  }

  const ready = context?.current != null && context.options.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Corriger la décision"
      className="fixed inset-0 z-[70] grid place-items-center bg-stone-900/45 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[15px] font-bold text-stone-900">
          Corriger la décision — {candidateName}
        </h2>

        {failed ? (
          <p className="mt-3 font-body text-[13px] text-rose-600">
            Impossible de charger l’état de ce dossier.
          </p>
        ) : !context ? (
          <p className="mt-3 font-body text-[13px] text-stone-500">Chargement…</p>
        ) : !ready ? (
          <p className="mt-3 font-body text-[13px] text-stone-500">
            Aucune décision à corriger sur ce dossier.
          </p>
        ) : (
          <>
            <CurrentDecisionBlock context={context} />
            <SideEffectsBlock context={context} />
            <TargetChoices
              options={context.options}
              selected={target}
              onSelect={setTarget}
            />

            <label className="mt-4 block">
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                Motif (facultatif, conservé au journal)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="erreur de manipulation — mauvaise ligne"
                className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 font-body text-[13px] text-stone-800 outline-none focus:border-stone-400"
              />
            </label>

            {context.notices.map((n) => (
              <p key={n} className="mt-2 font-body text-[12px] text-stone-500">
                {n}
              </p>
            ))}
          </>
        )}

        {error ? (
          <p className="mt-3 font-body text-[12px] text-rose-600">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !target || !ready}
            className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? 'Correction…' : 'Corriger la décision'}
          </button>
        </div>
      </div>
    </div>
  );
}
