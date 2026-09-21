'use client';

/**
 * Une ligne du formulaire APEC : libellé, champ, et PROVENANCE.
 *
 * La provenance n'est pas décorative. Une valeur déduite (« minimum 3 ans »
 * tirée de « confirmé ») doit se présenter comme une proposition, pas comme un
 * fait — c'est le même geste que le badge « Suggéré par l'IA » du
 * pré-remplissage par document. Sans elle, le recruteur ne sait pas quels
 * champs méritent son attention, et il les valide tous ou aucun.
 */
import type { CSSProperties, ReactNode } from 'react';

import type { AdepFieldNote } from '@/lib/jobboards/adep/mapping';
import { inputStyle, labelStyle } from './job-ad-panel-styles';

const hintStyle: CSSProperties = {
  fontSize: 11,
  marginTop: 3,
  color: 'var(--dash-text-secondary)',
};

const derivedStyle: CSSProperties = { ...hintStyle, color: 'var(--dash-orange)' };
const missingStyle: CSSProperties = { ...hintStyle, color: 'var(--dash-red)' };

export type ApecFieldRowProps = {
  label: string;
  note?: AdepFieldNote;
  /** Compteur « 38/80 », quand une borne Apec s'applique. */
  counter?: string;
  children: ReactNode;
};

export function ApecFieldRow({ label, note, counter, children }: ApecFieldRowProps) {
  return (
    <div>
      {/* ⚠️ Le libellé ENVELOPPE son champ — association implicite, sans
          identifiant à tenir d'accord entre deux fichiers. Posé À CÔTÉ, il
          n'était qu'un mot au-dessus d'une zone : on le cliquait, et rien ne
          se passait. Ici, le cliquer donne le focus, quel que soit le contrôle
          en dessous (champ, liste, zone de texte). */}
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <span
          style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}
        >
          <span>{label}</span>
          {counter ? (
            <span style={{ fontWeight: 400, color: 'var(--dash-text-secondary)' }}>
              {counter}
            </span>
          ) : null}
        </span>
        {children}
      </label>
      {note?.origin === 'derived' && note.from ? (
        <div style={derivedStyle}>← déduit de {note.from}, à confirmer</div>
      ) : null}
      {note?.origin === 'missing' && note.from ? (
        <div style={missingStyle}>{note.from}</div>
      ) : null}
      {note?.origin === 'certain' && note.from ? (
        <div style={hintStyle}>Repris de {note.from}</div>
      ) : null}
    </div>
  );
}

export type ApecSelectProps<T extends string> = {
  value: T | null;
  onChange: (value: T | null) => void;
  options: ReadonlyArray<readonly [T, string]>;
  /** Libellé du choix vide. Absent ⇒ le champ est obligatoire sans valeur nulle. */
  emptyLabel?: string;
};

export function ApecSelect<T extends string>({
  value,
  onChange,
  options,
  emptyLabel,
}: ApecSelectProps<T>) {
  return (
    <select
      style={inputStyle}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as T | null)}
    >
      {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
      {options.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * Options d'un menu, dans l'ORDRE CANONIQUE du domaine.
 *
 * Piloté par la liste de codes et non par `Object.entries` : celui-ci élargit
 * les clés en `string` (le type du code se perdrait, et `ApecSelect` ne
 * saurait plus ce qu'il rend), et il ordonne les clés numériques selon le
 * moteur JavaScript plutôt que selon la nomenclature Apec.
 */
export function domainOptions<T extends string>(
  codes: readonly T[],
  labels: Record<string, string>,
): ReadonlyArray<readonly [T, string]> {
  return codes.map((code) => [code, labels[code] ?? code] as const);
}
