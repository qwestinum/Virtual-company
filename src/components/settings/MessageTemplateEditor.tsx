'use client';

/**
 * Éditeur d'UN modèle de message (famille « Modèles de messages »).
 *
 * Brouillon local et enregistrement explicite — un modèle est long, on évite
 * un enregistrement par frappe. Chaque modèle a SON bouton : enregistrer l'un
 * n'écrit que lui (l'appelant fusionne dans la configuration courante), si
 * bien qu'un autre modèle ouvert et modifié à côté n'est ni enregistré ni
 * écrasé.
 */

import { useState } from 'react';

import type { MessageTemplate } from '@/lib/settings/message-templates';

export function MessageTemplateEditor({
  template,
  value,
  defaultValue,
  onSave,
}: {
  template: MessageTemplate;
  value: string;
  defaultValue: string;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  const empty = draft.trim().length === 0;

  return (
    <div className="flex flex-col gap-2 font-body text-[13px]">
      <p className="text-[12px] text-stone-600">
        <span className="font-semibold text-stone-800">Quand : </span>
        {template.when}
      </p>
      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-stone-700">Texte du message</span>
          {draft !== defaultValue ? (
            <button
              type="button"
              onClick={() => setDraft(defaultValue)}
              className="text-[11px] font-semibold text-stone-500 underline hover:text-stone-800"
            >
              Rétablir le texte proposé
            </button>
          ) : null}
        </span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          rows={10}
          className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-500">{template.hint}</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty || empty}
          className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Enregistrer ce modèle
        </button>
        {empty ? (
          <span className="text-[12px] text-amber-800">Un modèle ne peut pas être vide.</span>
        ) : null}
      </div>
    </div>
  );
}
