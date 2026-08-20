'use client';

/**
 * Suite d'une absence — le dialog qui SÉPARE le fait de la décision.
 *
 * Constater qu'un candidat n'est pas venu n'est pas décider de l'écarter. Le
 * marquage « absent » vaut pourtant, dans le pipeline, refus définitif : il
 * est donc posé APRÈS ce choix, jamais avant. Sans ce dialog, ouvrir la ligne
 * et cliquer suffirait à clore un dossier — et à déclencher les traitements
 * qui en découlent — sans que personne ne l'ait voulu.
 *
 * L'autre branche ne pose AUCUN marqueur : re-proposer un créneau, c'est
 * précisément ne rien décider. La trace d'audit du cycle absent → réinvité est
 * portée par le journal de réémission.
 */

import { useState } from 'react';

export type NoShowChoice = 'reject' | 'reinvite';

export function NoShowDialog({
  candidateName,
  busy,
  onCancel,
  onConfirm,
}: {
  candidateName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (choice: NoShowChoice) => void;
}) {
  const [choice, setChoice] = useState<NoShowChoice>('reject');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Suite à donner à l’absence"
      className="fixed inset-0 z-50 grid place-items-center bg-stone-900/45 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <h2 className="font-display text-[15px] font-bold text-stone-900">
          {candidateName} ne s’est pas présenté
        </h2>
        <p className="mt-1 font-body text-[13px] text-stone-600">
          Quelle suite donner ? Rien n’est décidé tant que vous n’avez pas
          confirmé.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Choice
            checked={choice === 'reject'}
            onSelect={() => setChoice('reject')}
            title="Classer non retenu"
            detail="L’absence clôt la candidature. Elle passe en « Non retenu »."
          />
          <Choice
            checked={choice === 'reinvite'}
            onSelect={() => setChoice('reinvite')}
            title="Re-proposer un créneau"
            detail="Un nouveau lien part au candidat. Aucune décision n’est prise."
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(choice)}
            disabled={busy}
            className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? 'En cours…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${
        checked ? 'border-stone-400 bg-stone-50' : 'border-stone-200'
      }`}
    >
      <input
        type="radio"
        name="no-show-choice"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5"
      />
      <span>
        <span className="block font-body text-[13px] font-semibold text-stone-800">
          {title}
        </span>
        <span className="block font-body text-[12px] text-stone-500">{detail}</span>
      </span>
    </label>
  );
}
