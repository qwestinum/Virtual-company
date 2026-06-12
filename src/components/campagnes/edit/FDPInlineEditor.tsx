'use client';

/**
 * Éditeur inline complet d'une fiche de poste (Session 6 v2).
 *
 * Réutilisé par :
 *   - `FDPEditBlock` (édition d'une campagne existante)
 *   - `CampaignCreateSheet` (création hors chat)
 *
 * Chaque champ devient un input adapté à son type — texte, select,
 * textarea (missions, compétences). Les arrays sont saisis sur des
 * lignes séparées dans une textarea pour rester simple en démo.
 *
 * L'éditeur est « contrôlé » par le parent qui détient l'objet
 * `FDPInProgress` et reçoit chaque patch via `onPatch`.
 */

import type { ChangeEvent } from 'react';

import {
  ContractTypeSchema,
  FIELD_KEYS,
  FIELD_LABELS,
  SenioritySchema,
  type FDPInProgress,
  type FieldKey,
  type FieldStatus,
} from '@/types/field-collection';

export type FDPInlineEditorProps = {
  fdp: FDPInProgress;
  onPatch: (key: FieldKey, value: unknown) => void;
  disabled?: boolean;
};

export function FDPInlineEditor({
  fdp,
  onPatch,
  disabled,
}: FDPInlineEditorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {FIELD_KEYS.map((key) => (
        <FieldRow
          key={key}
          fieldKey={key}
          field={fdp.fields[key]}
          onChange={(value) => onPatch(key, value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FieldRow({
  fieldKey,
  field,
  onChange,
  disabled,
}: {
  fieldKey: FieldKey;
  field: FieldStatus | undefined;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const label = FIELD_LABELS[fieldKey];
  const filled = field?.status === 'filled';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        borderRadius: 10,
        background: 'var(--dash-warm)',
        border: `1px solid ${filled ? 'var(--dash-border)' : 'var(--dash-border-strong)'}`,
      }}
    >
      <label
        className="font-body"
        style={{
          fontSize: 11,
          color: 'var(--dash-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </label>
      {renderInput(fieldKey, field?.value, onChange, disabled)}
    </div>
  );
}

function renderInput(
  key: FieldKey,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
) {
  const baseStyle = {
    width: '100%',
    border: 'none',
    background: 'transparent',
    outline: 'none',
    fontSize: 13,
    color: 'var(--dash-text)',
    padding: '4px 0',
    fontFamily: 'var(--font-nunito), system-ui, sans-serif',
  };
  switch (key) {
    case 'seniority': {
      const v = typeof value === 'string' ? value : '';
      return (
        <select
          value={v}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange(e.currentTarget.value || undefined)
          }
          style={baseStyle}
        >
          <option value="">—</option>
          {SenioritySchema.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    case 'contract_type': {
      const v = typeof value === 'string' ? value : '';
      return (
        <select
          value={v}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange(e.currentTarget.value || undefined)
          }
          style={baseStyle}
        >
          <option value="">—</option>
          {ContractTypeSchema.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    case 'main_missions':
    case 'key_skills': {
      const v = Array.isArray(value)
        ? value.join('\n')
        : typeof value === 'string'
          ? value
          : '';
      return (
        <textarea
          rows={key === 'main_missions' ? 4 : 3}
          value={v}
          disabled={disabled}
          placeholder="Une entrée par ligne"
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            const lines = e.currentTarget.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(lines.length === 0 ? undefined : lines);
          }}
          style={{ ...baseStyle, resize: 'vertical' }}
        />
      );
    }
    case 'start_date': {
      const v = typeof value === 'string' ? value : '';
      return (
        <input
          type="text"
          value={v}
          disabled={disabled}
          placeholder="ex. 1er juin 2026 ou 2026-06-01"
          onChange={(e) => onChange(e.currentTarget.value || undefined)}
          style={baseStyle}
        />
      );
    }
    default: {
      const v = typeof value === 'string' ? value : '';
      return (
        <input
          type="text"
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.value || undefined)}
          style={baseStyle}
        />
      );
    }
  }
}
