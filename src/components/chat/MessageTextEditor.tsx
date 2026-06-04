'use client';

import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { FieldKey } from '@/types/field-collection';

export type EditableField = {
  fieldKey: FieldKey;
  label: string;
  /** Valeur initiale = valeur du champ SOURCE (liste = un item/ligne). */
  initialValue: string;
};

export type MessageTextEditorProps = {
  /** Champs source à éditer en place (1..N), pré-remplis depuis la FDP. */
  fields: EditableField[];
  /** Valide — applique chaque valeur au champ source (FDP). */
  onSubmit: (edits: { fieldKey: FieldKey; raw: string }[]) => void;
  /** Abandonne l'édition — la source reste inchangée. */
  onCancel: () => void;
};

/**
 * Édition EN PLACE des champs source qu'une bulle Manager a proposés
 * (clic « Ajuster »). Un éditeur multi-ligne large par champ, libellé,
 * pré-rempli depuis la FDP (la source) — jamais le texte de la bulle.
 * Un seul Valider / Annuler pour l'ensemble.
 *
 * Raccourcis : Échap annule ; Ctrl/Cmd+Entrée valide. Entrée seule =
 * saut de ligne (on est en multi-ligne).
 */
export function MessageTextEditor({
  fields,
  onSubmit,
  onCancel,
}: MessageTextEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.fieldKey, f.initialValue])),
  );

  function submit() {
    onSubmit(
      fields.map((f) => ({ fieldKey: f.fieldKey, raw: drafts[f.fieldKey] ?? '' })),
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-stone-200 pt-2">
      {fields.map((f, index) => (
        <FieldRow
          key={f.fieldKey}
          label={f.label}
          value={drafts[f.fieldKey] ?? ''}
          autoFocus={index === 0}
          onChange={(v) =>
            setDrafts((prev) => ({ ...prev, [f.fieldKey]: v }))
          }
          onSubmit={submit}
          onCancel={onCancel}
        />
      ))}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="font-body text-[12px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-stone-600 hover:bg-stone-100 transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          className="font-body font-medium text-[12px] inline-flex items-center gap-1 px-3 py-1 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Valider
        </button>
      </div>
      <span className="font-body text-[10.5px] text-stone-400 self-end">
        Échap pour annuler · Ctrl+Entrée pour valider
      </span>
    </div>
  );
}

function FieldRow({
  label,
  value,
  autoFocus,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  value: string;
  autoFocus: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (autoFocus) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 280)}px`;
  }, [autoFocus]);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-700">
        {label}
      </span>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const ta = e.target;
          ta.style.height = 'auto';
          ta.style.height = `${Math.min(ta.scrollHeight, 280)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={2}
        className={cn(
          'font-body text-[14px] leading-relaxed w-full resize-none min-h-[64px]',
          'rounded-xl border border-indigo-300 bg-white px-3 py-2',
          'outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-300',
        )}
      />
    </div>
  );
}
