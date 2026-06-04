'use client';

import { Check, ChevronDown, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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
  /**
   * Token incrémental : quand il change, on déplie simplement la
   * checklist (sans ouvrir d'éditeur). Utilisé par « Ajuster » sur une
   * proposition multi-champ (fiche réutilisée en bloc).
   */
  expandToken?: number;
  /**
   * Applique un ajustement de champ à la SOURCE. Si fourni, la checklist
   * délègue au parent (qui écrit dans la FDP ET propage aux dérivés —
   * ex. proposition de refaire l'annonce). Sinon, fallback local direct
   * sur applyExtractions (collecte simple, sans dérivés).
   */
  onFieldEdit?: (fieldKey: FieldKey, raw: string) => void;
};

const ARRAY_FIELDS = new Set<FieldKey>(['main_missions', 'key_skills']);

export function FieldChecklist({
  fdp,
  defaultCollapsed = false,
  editingDisabled = false,
  openFirstMissingToken,
  expandToken,
  onFieldEdit,
}: FieldChecklistProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [editingKey, setEditingKey] = useState<FieldKey | null>(null);

  // Déplie la checklist quand expandToken change (« Ajuster » multi-champ).
  // Différé hors du cycle de rendu (règle « pas de setState sync en effet »).
  useEffect(() => {
    if (expandToken === undefined || expandToken === 0) return;
    const id = requestAnimationFrame(() => setCollapsed(false));
    return () => cancelAnimationFrame(id);
  }, [expandToken]);

  useEffect(() => {
    if (openFirstMissingToken === undefined || openFirstMissingToken === 0)
      return;
    if (editingDisabled) return;
    const firstMissing = FIELD_KEYS.find(
      (k) => fdp.fields[k]?.status !== 'filled',
    );
    if (!firstMissing) return;
    // Différé hors du cycle de rendu courant pour respecter la règle
    // « pas de setState synchrone dans un effet ».
    const id = requestAnimationFrame(() => {
      setCollapsed(false);
      setEditingKey(firstMissing);
    });
    return () => cancelAnimationFrame(id);
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
    if (onFieldEdit) {
      // Propagation source : le parent écrit dans la FDP et gère les
      // dérivés (ex. proposer de refaire l'annonce).
      onFieldEdit(key, trimmed);
      setEditingKey(null);
      return;
    }
    // Fallback local (pas de parent) : application directe sur la source.
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
  const isArray = ARRAY_FIELDS.has(fieldKey);
  // Champ liste → une valeur par ligne (multi-ligne confortable) ;
  // champ scalaire → une seule ligne.
  const [draft, setDraft] = useState(() =>
    isArray
      ? (initialValue ?? '')
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join('\n')
      : (initialValue ?? ''),
  );

  // Champ liste : éditeur multi-ligne pleine largeur, empilé.
  if (isArray) {
    return (
      <div className="flex flex-col gap-1.5 w-full mt-1">
        <ArrayFieldTextarea
          value={draft}
          onChange={setDraft}
          onSubmit={() => onSubmit(draft)}
          onCancel={onCancel}
        />
        <div className="flex items-center justify-end gap-1">
          <EditorIconButton label="Annuler" onClick={onCancel} variant="cancel">
            <X className="h-3 w-3" aria-hidden />
          </EditorIconButton>
          <EditorIconButton
            label="Enregistrer"
            onClick={() => onSubmit(draft)}
            variant="save"
          >
            <Check className="h-3 w-3" aria-hidden />
          </EditorIconButton>
        </div>
      </div>
    );
  }

  // Champ scalaire : input compact en ligne.
  return (
    <div className="flex items-center gap-1 max-w-[65%] min-w-0">
      <ScalarFieldInput
        value={draft}
        onChange={setDraft}
        onSubmit={() => onSubmit(draft)}
        onCancel={onCancel}
      />
      <EditorIconButton
        label="Enregistrer"
        onClick={() => onSubmit(draft)}
        variant="save"
      >
        <Check className="h-3 w-3" aria-hidden />
      </EditorIconButton>
      <EditorIconButton label="Annuler" onClick={onCancel} variant="cancel">
        <X className="h-3 w-3" aria-hidden />
      </EditorIconButton>
    </div>
  );
}

function ArrayFieldTextarea({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      rows={3}
      placeholder="une valeur par ligne"
      className={cn(
        'font-body text-[12px] w-full resize-y min-h-[68px] px-2 py-1 rounded border',
        'border-indigo-300 bg-white outline-none',
        'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-300',
      )}
    />
  );
}

function ScalarFieldInput({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => ref.current?.focus());
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder="votre valeur"
      className={cn(
        'font-body text-[12px] flex-1 min-w-0 px-2 py-0.5 rounded border',
        'border-indigo-300 bg-white outline-none',
        'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-300',
      )}
    />
  );
}

function EditorIconButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  variant: 'save' | 'cancel';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'h-5 w-5 grid place-items-center rounded shrink-0',
        variant === 'save'
          ? 'text-emerald-600 hover:bg-emerald-50'
          : 'text-stone-500 hover:bg-stone-100',
      )}
    >
      {children}
    </button>
  );
}
