'use client';

/**
 * Champ « type de contrat » : MULTI-sélection des options prédéfinies + saisie
 * libre (« Autre… »). Extrait de `FDPInlineEditor` (qui dépassait 200 lignes).
 *
 * Lecture/écriture en LISTE (`string[]`) via les helpers purs
 * `@/lib/fdp/contract-type` : rétro-compat (ancienne valeur unique lue comme
 * liste à 1) et déduplication insensible casse/accents (un « cdi » saisi en
 * libre fusionne sur l'option `CDI`). Liste vide → `undefined` (champ « vide »).
 */

import { useState, type KeyboardEvent } from 'react';

import {
  CONTRACT_TYPE_OPTIONS,
  addContract,
  asContractList,
  hasContract,
  isPredefinedContract,
  toggleContract,
} from '@/lib/fdp/contract-type';

export function ContractTypeField({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const selected = asContractList(value);
  const [custom, setCustom] = useState('');

  const emit = (list: string[]) => onChange(list.length > 0 ? list : undefined);

  const commitCustom = () => {
    const next = addContract(selected, custom);
    setCustom('');
    if (next !== selected) emit(next);
  };

  const onCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCustom();
    }
  };

  // Valeurs saisies en libre = sélectionnées mais hors options prédéfinies.
  const customs = selected.filter((s) => !isPredefinedContract(s));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CONTRACT_TYPE_OPTIONS.map((opt) => {
          const on = hasContract(selected, opt);
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => emit(toggleContract(selected, opt))}
              style={chipStyle(on, disabled)}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {customs.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {customs.map((c) => (
            <span key={c} style={{ ...chipStyle(true, disabled), cursor: 'default' }}>
              {c}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Retirer ${c}`}
                onClick={() => emit(selected.filter((e) => e !== c))}
                style={{
                  marginLeft: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: disabled ? 'default' : 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={custom}
          disabled={disabled}
          placeholder="Autre… (saisie libre)"
          onChange={(e) => setCustom(e.currentTarget.value)}
          onKeyDown={onCustomKeyDown}
          onBlur={commitCustom}
          style={{
            flex: 1,
            border: '1px solid var(--dash-border)',
            borderRadius: 8,
            background: 'var(--dash-card, #fff)',
            outline: 'none',
            fontSize: 13,
            color: 'var(--dash-text)',
            padding: '4px 8px',
            fontFamily: 'var(--font-nunito), system-ui, sans-serif',
          }}
        />
      </div>
    </div>
  );
}

function chipStyle(active: boolean, disabled?: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    padding: '3px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-nunito), system-ui, sans-serif',
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${active ? 'var(--dash-accent, #b45309)' : 'var(--dash-border-strong)'}`,
    background: active ? 'var(--dash-accent-soft, #fef3c7)' : 'transparent',
    color: active ? 'var(--dash-accent-strong, #92400e)' : 'var(--dash-text)',
    opacity: disabled ? 0.6 : 1,
  } as const;
}
