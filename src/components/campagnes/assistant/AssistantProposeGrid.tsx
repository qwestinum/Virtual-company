'use client';

/**
 * « Proposer la grille » — l'autre chemin de l'ancienne feuille de création,
 * repris ici : le modèle lit la fiche de poste et propose des critères.
 *
 * ⚠️ Il REMPLACE la grille courante, et c'est dit avant de cliquer. Fusionner
 * silencieusement laisserait des critères d'une proposition précédente mêlés à
 * la nouvelle, sans qu'on sache lesquels viennent d'où.
 */

import { useState } from 'react';

import { postManagerScoring } from '@/lib/chat/api-client';
import type { FDPInProgress } from '@/types/field-collection';
import type { ScoringCriterion } from '@/types/scoring';

export function AssistantProposeGrid({
  fdp,
  onPropose,
}: {
  fdp: FDPInProgress;
  onPropose: (criteria: ScoringCriterion[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proposer() {
    setBusy(true);
    setError(null);
    try {
      const { criteria } = await postManagerScoring({ fdp });
      if (criteria.length > 0) onPropose(criteria);
      else setError('Le modèle n’a rien proposé sur cette fiche. Éditez la grille à la main.');
    } catch {
      setError(
        'La proposition n’est pas disponible pour le moment. Vous pouvez éditer la grille à la main.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        data-role="propose-grid"
        disabled={busy}
        onClick={proposer}
        className="font-body"
        style={{
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px dashed var(--dash-border-strong)',
          background: 'var(--dash-surface)',
          color: 'var(--dash-text-secondary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
        }}
      >
        {busy ? 'Rédaction…' : '✨ Proposer la grille à partir de la fiche'}
      </button>
      <span
        className="font-body"
        style={{ marginLeft: 10, fontSize: 11, color: 'var(--dash-text-secondary)' }}
      >
        Remplace les critères ci-dessous.
      </span>
      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
