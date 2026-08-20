'use client';

/**
 * Confirmation d'un refus groupé — étape OBLIGATOIRE, jamais escamotable.
 *
 * Un refus part chez une personne. En envoyer quarante d'un clic mérite qu'on
 * relise la liste nominative et le modèle de mail avant, pas après. La liste
 * est donc affichée en entier (défilante), avec le score de chacun.
 *
 * La case « envoyer les mails » est cochée par défaut : écrire au candidat est
 * la courtoisie attendue, la décocher est le geste explicite — et ce geste
 * s'écrit au journal comme un choix, pas comme une panne.
 */

import { useState } from 'react';

import type { PendingValidation } from '@/types/hitl';

export function BulkRejectDialog({
  items,
  running,
  progress,
  onConfirm,
  onCancel,
}: {
  items: PendingValidation[];
  running: boolean;
  progress: { done: number; total: number } | null;
  onConfirm: (sendMail: boolean) => void;
  onCancel: () => void;
}) {
  const [sendMail, setSendMail] = useState(true);
  const n = items.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-stone-200 bg-white shadow-xl">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="font-display text-[16px] font-bold text-stone-900">
            Refuser {n} candidature{n > 1 ? 's' : ''}
          </h2>
          <p className="mt-1 font-body text-[12.5px] text-stone-600">
            Chaque candidature est traitée individuellement. Ce qui échoue reste
            en attente et pourra être retenté.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ul className="flex flex-col gap-1">
            {items.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 border-b border-stone-100 py-1.5 last:border-b-0"
              >
                <span className="min-w-0 truncate font-body text-[13px] text-stone-800">
                  {v.candidateName}
                  <span className="ml-2 font-data text-[11.5px] text-stone-400">
                    {v.campaignId}
                  </span>
                </span>
                <span className="shrink-0 font-data text-[12px] font-semibold text-stone-500">
                  {v.score != null ? `${v.score}/100` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-stone-200 px-5 py-4">
          <label className="flex items-start gap-2 font-body text-[12.5px] text-stone-700">
            <input
              type="checkbox"
              checked={sendMail}
              disabled={running}
              onChange={(e) => setSendMail(e.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>
              Envoyer les mails de refus (modèle de refus de la campagne).
              {sendMail ? null : (
                <span className="mt-1 block text-[12px] font-semibold text-amber-700">
                  Les décisions seront enregistrées, mais aucun candidat ne sera
                  informé — ils apparaîtront comme «&nbsp;décidés, non
                  contactés&nbsp;».
                </span>
              )}
            </span>
          </label>

          {progress ? (
            <p className="mt-3 font-body text-[12.5px] text-stone-600">
              Traitement {progress.done}/{progress.total}…
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={running}
              className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12.5px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => onConfirm(sendMail)}
              disabled={running || n === 0}
              className="rounded-lg bg-rose-600 px-4 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
            >
              {running ? 'Traitement…' : `Refuser ces ${n}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
