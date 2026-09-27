'use client';

/**
 * Les trois contrôles du produit — champ, zone de texte, liste déroulante —
 * bâtis sur LA MÊME boîte (`FIELD_BOX`).
 *
 * Trois styles écrits séparément finiraient par diverger, et la divergence
 * serait muette : une liste à la bordure faible au milieu de champs corrects
 * ne fait rougir aucun compilateur.
 */

import type { ChangeEvent, ReactNode } from 'react';

import { FIELD_BOX } from './FormField';

type Commun = {
  id: string;
  disabled?: boolean;
  /** L'exemple vit DANS le champ, jamais au-dessus. */
  placeholder?: string;
};

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
  inputMode,
}: Commun & {
  value: string;
  onChange: (next: string) => void;
  type?: 'text' | 'email' | 'url' | 'number';
  inputMode?: 'numeric' | 'text' | 'email' | 'url';
}) {
  return (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
      className="orqa-field font-body"
      style={FIELD_BOX}
    />
  );
}

export function TextAreaInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  rows = 3,
}: Commun & {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  rows?: number;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.currentTarget.value)}
      onBlur={onBlur}
      className="orqa-field font-body"
      style={{ ...FIELD_BOX, minHeight: 84, resize: 'vertical', lineHeight: 1.5 }}
    />
  );
}

export function SelectInput({
  id,
  value,
  onChange,
  disabled,
  children,
}: Commun & {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.currentTarget.value)}
      className="orqa-field font-body"
      style={{ ...FIELD_BOX, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </select>
  );
}
