'use client';

/**
 * Le bandeau du bloc de démarrage, et ce qu'on transmet au modèle.
 */

import type { ReactNode } from 'react';

import type { CSSProperties } from 'react';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';

/** Le bouton « raccourci » du bloc de démarrage — tiret, sobre, non primaire. */
export const BOUTON: CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px dashed var(--dash-border-strong)',
  background: 'var(--dash-surface)',
  color: 'var(--dash-text-secondary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

export function Bandeau({ ton, children }: { ton: 'blue' | 'green'; children: ReactNode }) {
  const couleur = ton === 'blue' ? 'var(--dash-blue)' : 'var(--dash-green)';
  const fond = ton === 'blue' ? 'var(--dash-blue-light)' : 'var(--dash-green-light)';
  return (
    <div
      role="status"
      className="font-body"
      style={{
        marginTop: 12,
        padding: '10px 12px',
        borderRadius: 10,
        background: fond,
        border: `1px solid ${couleur}`,
        color: couleur,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/** Ce que le recruteur a DÉJÀ renseigné — le modèle ne le repropose pas. */
export function champsRenseignes(fdp: FDPInProgress): Partial<Record<FieldKey, unknown>> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const key of Object.keys(fdp.fields) as FieldKey[]) {
    const champ = fdp.fields[key];
    if (champ && champ.status === 'filled') out[key] = champ.value;
  }
  return out;
}
