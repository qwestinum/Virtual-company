'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { KeywordsInput } from '@/components/scoring/KeywordsInput';
import { MethodBadge } from '@/components/scoring/MethodBadge';
import { VerificationMethodSelector } from '@/components/scoring/VerificationMethodSelector';
import { cn } from '@/lib/utils';
import {
  DEFAULT_VERIFICATION_METHOD,
  isKnockoutCriterion,
  SCORING_LEVEL_COLORS,
  SCORING_LEVEL_LABELS,
  SCORING_LEVELS,
  validateScoringSheet,
  type ScoringCriterion,
  type ScoringLevel,
  type ScoringSheet,
  type VerificationMethod,
} from '@/types/scoring';

export type ScoringSheetEditorProps = {
  sheet: ScoringSheet;
  confirmed: boolean;
  disabled?: boolean;
  onAddCriterion: (input: { label: string; level: ScoringLevel }) => void;
  onUpdateCriterion: (
    id: string,
    patch: Partial<
      Pick<
        ScoringCriterion,
        'label' | 'level' | 'weight' | 'verificationMethod' | 'keywords'
      >
    >,
  ) => void;
  onRemoveCriterion: (id: string) => void;
  onValidate: () => void;
};

const DEFAULT_NEW_LEVEL: ScoringLevel = 'important';

export function ScoringSheetEditor({
  sheet,
  confirmed,
  disabled = false,
  onAddCriterion,
  onUpdateCriterion,
  onRemoveCriterion,
  onValidate,
}: ScoringSheetEditorProps) {
  const isLocked = confirmed || disabled;
  const [newLabel, setNewLabel] = useState('');
  const [newLevel, setNewLevel] = useState<ScoringLevel>(DEFAULT_NEW_LEVEL);
  // Cohérence hybride : une méthode déterministe/hybride exige ≥ 1 mot-clé.
  const validationErrors = isLocked ? [] : validateScoringSheet(sheet);
  const canValidate = sheet.criteria.length > 0 && validationErrors.length === 0;

  function handleAdd() {
    const trimmed = newLabel.trim();
    if (trimmed.length === 0) return;
    onAddCriterion({ label: trimmed, level: newLevel });
    setNewLabel('');
    setNewLevel(DEFAULT_NEW_LEVEL);
  }

  return (
    <div className="mt-2 grid gap-2">
      <p className="font-body text-[11px] text-stone-500 mb-1">
        Fiche de scoring pour {sheet.campaignId}. {sheet.criteria.length}{' '}
        critère{sheet.criteria.length > 1 ? 's' : ''}. Ajustez le libellé, le
        niveau ou le poids selon le contexte.
      </p>

      {sheet.criteria.map((criterion) => (
        <CriterionRow
          key={criterion.id}
          criterion={criterion}
          locked={isLocked}
          onUpdate={(patch) => onUpdateCriterion(criterion.id, patch)}
          onRemove={() => onRemoveCriterion(criterion.id)}
        />
      ))}

      {!isLocked ? (
        <div className="mt-1 flex items-center gap-1.5 rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-2 py-1.5">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Nouveau critère (ex. « Certification PMP »)"
            className={cn(
              'font-body text-[12px] flex-1 min-w-0 px-2 py-1 rounded border',
              'border-stone-300 bg-white outline-none',
              'focus:border-stone-500 focus:ring-1 focus:ring-stone-300',
            )}
          />
          <LevelSelect
            value={newLevel}
            onChange={setNewLevel}
            disabled={false}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={newLabel.trim().length === 0}
            className={cn(
              'h-7 px-2.5 rounded font-display text-[11px] font-semibold flex items-center gap-1 shrink-0',
              newLabel.trim().length === 0
                ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                : 'bg-stone-700 text-white hover:bg-stone-900',
            )}
          >
            <Plus className="h-3 w-3" aria-hidden /> Ajouter
          </button>
        </div>
      ) : null}

      {validationErrors.length > 0 ? (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5">
          {validationErrors.map((e, i) => (
            <li key={i} className="font-body text-[11px] text-amber-800">
              {e}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={isLocked || !canValidate}
        onClick={() => !isLocked && canValidate && onValidate()}
        className={cn(
          'mt-1 w-full rounded-xl border px-3 py-2.5',
          'font-display font-semibold text-[13px] transition-all',
          isLocked || !canValidate
            ? 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'
            : 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600',
        )}
      >
        {confirmed
          ? `Fiche validée (${sheet.criteria.length} critère${sheet.criteria.length > 1 ? 's' : ''})`
          : sheet.criteria.length === 0
            ? 'Ajoutez au moins un critère'
            : validationErrors.length > 0
              ? 'Complétez les mots-clés des critères déterministes'
              : sheet.criteria.length === 1
                ? 'Valider la fiche de scoring (1 critère)'
                : `Valider la fiche de scoring (${sheet.criteria.length} critères)`}
      </button>
    </div>
  );
}

function CriterionRow({
  criterion,
  locked,
  onUpdate,
  onRemove,
}: {
  criterion: ScoringCriterion;
  locked: boolean;
  onUpdate: (
    patch: Partial<
      Pick<
        ScoringCriterion,
        'label' | 'level' | 'weight' | 'verificationMethod' | 'keywords'
      >
    >,
  ) => void;
  onRemove: () => void;
}) {
  const knockout = isKnockoutCriterion(criterion);
  const accent = SCORING_LEVEL_COLORS[criterion.level];
  const method: VerificationMethod =
    criterion.verificationMethod ?? DEFAULT_VERIFICATION_METHOD;
  const showKeywords = method !== 'llm_with_quote';
  const showSuggest =
    method === 'keywords_with_variants' || method === 'hybrid_keywords_llm';
  return (
    <div
      className={cn(
        'rounded-xl border px-2.5 py-1.5 flex flex-col gap-1.5',
        'transition-colors',
        locked
          ? 'border-stone-200 bg-stone-50/60'
          : 'border-stone-200 bg-white hover:border-stone-300',
      )}
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={criterion.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          disabled={locked}
          className={cn(
            'font-body text-[12px] flex-1 min-w-0 px-2 py-1 rounded border',
            locked
              ? 'border-transparent bg-transparent cursor-not-allowed'
              : 'border-stone-200 bg-white outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-300',
          )}
        />
        <MethodBadge method={method} />
        <LevelSelect
          value={criterion.level}
          onChange={(level) => onUpdate({ level })}
          disabled={locked}
        />
        {knockout ? (
          <span
            className="font-display text-[9px] uppercase tracking-[0.12em] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 shrink-0"
            title="Critère rédhibitoire — knockout sur le scoring CV"
          >
            K.O.
          </span>
        ) : (
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={criterion.weight}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0) onUpdate({ weight: n });
            }}
            disabled={locked}
            className={cn(
              'font-data text-[12px] tabular-nums w-14 px-2 py-1 rounded border text-center shrink-0',
              locked
                ? 'border-transparent bg-transparent cursor-not-allowed text-stone-700'
                : 'border-stone-200 bg-white outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-300',
            )}
          />
        )}
        {!locked ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Supprimer ce critère"
            className="h-6 w-6 grid place-items-center rounded text-stone-400 hover:text-red-600 hover:bg-red-50 shrink-0"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>

      {!locked ? (
        <div className="flex flex-col gap-1.5 pl-0.5">
          <VerificationMethodSelector
            value={method}
            onChange={(m) => onUpdate({ verificationMethod: m })}
            disabled={locked}
          />
          {showKeywords ? (
            <KeywordsInput
              keywords={criterion.keywords ?? []}
              onChange={(kw) => onUpdate({ keywords: kw })}
              showSuggest={showSuggest}
              criterionLabel={criterion.label}
              targetMethod={method}
              label={
                method === 'hybrid_keywords_llm' ? 'Mots-clés gardiens' : 'Mots-clés'
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LevelSelect({
  value,
  onChange,
  disabled,
}: {
  value: ScoringLevel;
  onChange: (level: ScoringLevel) => void;
  disabled: boolean;
}) {
  const accent = SCORING_LEVEL_COLORS[value];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ScoringLevel)}
      disabled={disabled}
      className={cn(
        'font-display text-[11px] font-semibold px-1.5 py-1 rounded border shrink-0',
        'min-w-[120px]',
        disabled
          ? 'border-transparent bg-transparent cursor-not-allowed'
          : 'border-stone-200 bg-white outline-none focus:border-stone-500',
      )}
      style={{ color: accent }}
    >
      {SCORING_LEVELS.map((lvl) => (
        <option key={lvl} value={lvl}>
          {SCORING_LEVEL_LABELS[lvl]}
        </option>
      ))}
    </select>
  );
}
