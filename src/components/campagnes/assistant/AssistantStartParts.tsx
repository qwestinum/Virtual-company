'use client';

/**
 * Le bandeau du bloc de démarrage, et ce qu'on transmet au modèle.
 */

import { Loader2 } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

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

/**
 * « Lecture en cours » — la preuve que quelque chose TOURNE pendant qu'on lit
 * un document. Un bouton qui change de libellé ne suffisait pas : l'œil est
 * déjà ailleurs, l'écran paraît figé, et on clique partout. D'où un bandeau
 * pleine largeur, animé, qui dit ce qui se passe, combien de temps ça prend,
 * et que la fiche se remplira toute seule. Le compteur de secondes rassure
 * mieux qu'une promesse : il bouge.
 */
export function LectureEnCours({ fileName }: { fileName: string }) {
  const [secondes, setSecondes] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div
      data-role="document-reading"
      role="status"
      aria-live="polite"
      className="font-body"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginTop: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--dash-blue-light)',
        border: '1px solid var(--dash-blue)',
        color: 'var(--dash-blue)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>Lecture de « {fileName} » en cours…</strong>
        <br />
        La fiche de poste se remplira toute seule dans un instant (souvent 15 à
        30 secondes). Restez sur cette page.
      </div>
      <span className="font-data" aria-hidden style={{ fontWeight: 700 }}>
        {secondes} s
      </span>
    </div>
  );
}
