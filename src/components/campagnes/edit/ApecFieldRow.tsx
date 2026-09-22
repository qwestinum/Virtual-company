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
import type { AdepOffer } from '@/types/adep';

import { useApecFieldState } from './ApecFieldContext';
import { inputStyle, labelStyle } from './job-ad-panel-styles';

const hintStyle: CSSProperties = {
  fontSize: 11,
  marginTop: 3,
  color: 'var(--dash-text-secondary)',
};

const derivedStyle: CSSProperties = { ...hintStyle, color: 'var(--dash-orange)' };
/** À compléter : une action attendue, pas une erreur. */
const missingStyle: CSSProperties = { ...hintStyle, color: 'var(--dash-orange-text)' };
/** Bloquant : la publication est impossible tant que ce n'est pas réglé. */
const blockingStyle: CSSProperties = { ...hintStyle, color: 'var(--dash-red)' };
/** Erreur de la dernière vérification — texte en AA sur fond clair. */
const errorHintStyle: CSSProperties = {
  ...hintStyle,
  marginTop: 5,
  fontWeight: 600,
  color: 'var(--dash-red-text)',
};

export type ApecFieldRowProps = {
  label: string;
  note?: AdepFieldNote;
  /** Compteur « 38/80 », quand une borne Apec s'applique. */
  counter?: string;
  /** Explication permanente du champ, sous la provenance. */
  hint?: ReactNode;
  /**
   * Le champ de l'offre que la ligne édite. Il porte l'astérisque
   * « obligatoire » et l'encadré d'erreur ; absent ⇒ ni l'un ni l'autre.
   */
  field?: keyof AdepOffer;
  children: ReactNode;
};

export function ApecFieldRow({ label, note, counter, hint, field, children }: ApecFieldRowProps) {
  const { required, error } = useApecFieldState(field);
  return (
    // `data-apec-field` : la liste des erreurs y conduit le focus.
    <div data-apec-field={field} data-apec-invalid={error ? 'true' : undefined}>
      {/* ⚠️ Le libellé ENVELOPPE son champ — association implicite, sans
          identifiant à tenir d'accord entre deux fichiers. Posé À CÔTÉ, il
          n'était qu'un mot au-dessus d'une zone : on le cliquait, et rien ne
          se passait. Ici, le cliquer donne le focus, quel que soit le contrôle
          en dessous (champ, liste, zone de texte). */}
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <span
          style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}
        >
          <span>
            {label}
            {required ? (
              <span aria-hidden style={{ color: 'var(--dash-red-text)', marginLeft: 2 }}>
                *
              </span>
            ) : null}
            {required ? <span className="sr-only"> (obligatoire)</span> : null}
          </span>
          {counter ? (
            <span style={{ fontWeight: 400, color: 'var(--dash-text-secondary)' }}>
              {counter}
            </span>
          ) : null}
        </span>
        {/* En faute : le champ est ENCADRÉ, pas seulement cité dans une liste
            en bas du panneau — c'est lui qu'il faut retrouver. */}
        <div
          style={
            error
              ? { borderRadius: 9, boxShadow: '0 0 0 2px var(--dash-red)' }
              : undefined
          }
        >
          {children}
        </div>
      </label>
      {error ? (
        <div role="alert" style={errorHintStyle}>
          {error}
        </div>
      ) : null}
      {note?.origin === 'derived' && note.from ? (
        <div style={derivedStyle}>← déduit de {note.from}, à confirmer</div>
      ) : null}
      {note?.origin === 'missing' && note.from ? (
        <div style={note.blocking ? blockingStyle : missingStyle}>{note.from}</div>
      ) : null}
      {note?.origin === 'certain' && note.from ? (
        <div style={hintStyle}>Repris de {note.from}</div>
      ) : null}
      {hint ? <div style={hintStyle}>{hint}</div> : null}
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
