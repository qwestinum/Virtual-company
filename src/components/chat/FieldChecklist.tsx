'use client';

import { Check, ChevronDown, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useFdpStore } from '@/stores/fdp-store';
import {
  FIELD_KEYS,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';

export type FieldChecklistProps = {
  fdp: FDPInProgress;
  defaultCollapsed?: boolean;
  /**
   * Désactive l'édition manuelle (par ex. quand un agent est en cours
   * d'exécution et qu'on ne veut pas que le DRH modifie la FDP).
   */
  editingDisabled?: boolean;
  /**
   * Token incrémental : quand il change, on déplie la checklist et on
   * ouvre l'éditeur du PREMIER champ encore vide. Utilisé par le
   * bouton « Il manque X champs » de ValidateFDPButton pour donner un
   * point d'entrée explicite quand le LLM oublie une extraction.
   */
  openFirstMissingToken?: number;
};

const ARRAY_FIELDS = new Set<FieldKey>(['main_missions', 'key_skills']);

export function FieldChecklist({
  fdp,
  defaultCollapsed = false,
  editingDisabled = false,
  openFirstMissingToken,
}: FieldChecklistProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [editingKey, setEditingKey] = useState<FieldKey | null>(null);

  useEffect(() => {
    if (openFirstMissingToken === undefined || openFirstMissingToken === 0)
      return;
    if (editingDisabled) return;
    const firstMissing = FIELD_KEYS.find(
      (k) => fdp.fields[k]?.status !== 'filled',
    );
    if (!firstMissing) return;
    setCollapsed(false);
    setEditingKey(firstMissing);
  }, [openFirstMissingToken, editingDisabled, fdp.fields]);
  const applyExtractions = useFdpStore((s) => s.applyExtractions);
  const total = FIELD_KEYS.length;
  const filledCount = FIELD_KEYS.filter(
    (k) => fdp.fields[k]?.status === 'filled',
  ).length;
  const progressPct = Math.round((filledCount / total) * 100);

  function handleSubmit(key: FieldKey, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setEditingKey(null);
      return;
    }
    const value: unknown = ARRAY_FIELDS.has(key)
      ? trimmed
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : trimmed;
    applyExtractions({ [key]: value } as Partial<Record<FieldKey, unknown>>);
    setEditingKey(null);
  }

  return (
    <div className="border-b border-stone-200 bg-gradient-to-b from-white to-stone-50">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-2 flex items-center justify-between gap-3 hover:bg-stone-100/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {fdp.isComplete ? (
            <Check
              className="h-3.5 w-3.5 text-emerald-600 shrink-0"
              aria-hidden
            />
          ) : (
            <Loader2
              className="h-3.5 w-3.5 text-stone-500 animate-spin shrink-0"
              aria-hidden
            />
          )}
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700 truncate">
            Fiche de poste
          </span>
          <span
            className={cn(
              'font-data text-[11px] shrink-0 tabular-nums',
              fdp.isComplete ? 'text-emerald-700' : 'text-indigo-600',
            )}
          >
            {filledCount}/{total}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-stone-500 transition-transform',
            collapsed ? '-rotate-90' : '',
          )}
          aria-hidden
        />
      </button>

      <div className="px-4">
        <div className="h-1 w-full rounded-full bg-indigo-100 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              fdp.isComplete ? 'bg-emerald-500' : 'bg-indigo-500',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {!collapsed ? (
        <ul className="px-4 py-3 space-y-1.5">
          {FIELD_KEYS.map((key) => {
            const field = fdp.fields[key];
            const filled = field?.status === 'filled';
            const inProgress = field?.status === 'in_progress';
            const value = filled ? formatValue(field.value) : null;
            const isEditing = editingKey === key;
            return (
              <li
                key={key}
                className="flex items-start justify-between gap-3 text-[12px]"
              >
                <span
                  className={cn(
                    'flex items-center gap-1.5 font-display font-medium shrink-0',
                    filled
                      ? 'text-indigo-800'
                      : inProgress
                        ? 'text-amber-700'
                        : 'text-stone-500',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      filled
                        ? 'bg-emerald-500'
                        : inProgress
                          ? 'bg-amber-400'
                          : 'bg-stone-300',
                    )}
                    aria-hidden
                  />
                  {field?.label ?? key}
                </span>
                {isEditing ? (
                  <FieldEditor
                    fieldKey={key}
                    initialValue={value}
                    onSubmit={(raw) => handleSubmit(key, raw)}
                    onCancel={() => setEditingKey(null)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={editingDisabled}
                    onClick={() => setEditingKey(key)}
                    className={cn(
                      'group flex items-center gap-1 font-body text-right truncate min-w-0 max-w-[60%]',
                      'transition-colors rounded px-1 -mx-1 py-0.5',
                      filled
                        ? 'text-stone-800 hover:text-indigo-700 hover:bg-indigo-50'
                        : inProgress
                          ? 'text-amber-700 hover:bg-amber-50'
                          : 'text-stone-400 italic hover:text-stone-700 hover:bg-stone-100',
                      editingDisabled &&
                        'opacity-60 hover:bg-transparent hover:text-inherit cursor-not-allowed',
                    )}
                    title={editingDisabled ? undefined : 'Modifier ce champ'}
                  >
                    <span className="truncate">
                      {filled
                        ? value
                        : inProgress
                          ? 'en cours…'
                          : 'à préciser'}
                    </span>
                    <Pencil
                      className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
                      aria-hidden
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="h-2" />
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  return JSON.stringify(value);
}

function FieldEditor({
  fieldKey,
  initialValue,
  onSubmit,
  onCancel,
}: {
  fieldKey: FieldKey;
  initialValue: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const placeholder = ARRAY_FIELDS.has(fieldKey)
    ? 'séparé par des virgules'
    : 'votre valeur';

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  return (
    <div className="flex items-center gap-1 max-w-[65%] min-w-0">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit(draft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className={cn(
          'font-body text-[12px] flex-1 min-w-0 px-2 py-0.5 rounded border',
          'border-indigo-300 bg-white outline-none',
          'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-300',
        )}
      />
      <button
        type="button"
        aria-label="Enregistrer"
        onClick={() => onSubmit(draft)}
        className="h-5 w-5 grid place-items-center rounded text-emerald-600 hover:bg-emerald-50 shrink-0"
      >
        <Check className="h-3 w-3" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Annuler"
        onClick={onCancel}
        className="h-5 w-5 grid place-items-center rounded text-stone-500 hover:bg-stone-100 shrink-0"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
