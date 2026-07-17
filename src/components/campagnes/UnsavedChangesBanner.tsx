'use client';

/**
 * Bannière « modifications non enregistrées » (anti-perte silencieuse).
 *
 * Les éditions de campagne/tâche sont en autosave et les artefacts poussés en
 * fire-and-forget : un push de fond peut échouer (réseau/serveur). Plutôt que
 * de perdre la modif en silence au reload, on la signale ici et on offre un
 * réessai. Couvre les TROIS registres du store de synchro (audit C7) :
 * campagnes, sollicitations, artefacts. Affichée seulement s'il y a au moins
 * une entité en échec de synchro.
 */

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { retryFailedArtifactPushes } from '@/lib/db/sync/artifacts-sync';
import { retryFailedCampaignPushes } from '@/lib/db/sync/campaigns-sync';
import { retryFailedTaskPushes } from '@/lib/db/sync/tasks-sync';
import { useSyncStatusStore } from '@/stores/sync-status-store';

export function UnsavedChangesBanner() {
  const names = useSyncStatusStore(
    useShallow((s) => [
      ...Object.values(s.failedCampaigns).map((c) => c.name),
      ...Object.values(s.failedTasks).map((t) => t.name),
      ...Object.values(s.failedArtifacts).map((a) => a.artifact.name),
    ]),
  );
  const [retrying, setRetrying] = useState(false);

  if (names.length === 0) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retryFailedCampaignPushes();
      await retryFailedTaskPushes();
      await retryFailedArtifactPushes();
    } finally {
      setRetrying(false);
    }
  };

  const shown = names
    .map((n) => `« ${n} »`)
    .slice(0, 3)
    .join(', ');
  const extra = names.length > 3 ? ` et ${names.length - 3} autre(s)` : '';

  return (
    <div
      role="alert"
      className="font-body"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        marginBottom: 16,
        borderRadius: 12,
        background: 'var(--dash-red-light)',
        border: '1px solid var(--dash-red)',
        color: 'var(--dash-text)',
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
        ⚠️
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="font-display"
          style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-red)' }}
        >
          {names.length === 1
            ? 'Une modification n’a pas pu être enregistrée'
            : `${names.length} modifications n’ont pas pu être enregistrées`}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
            marginTop: 1,
          }}
        >
          {shown}
          {extra}. Vos changements risquent d’être perdus au rechargement —
          réessayez l’enregistrement.
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="font-display"
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: retrying ? 'var(--dash-hover)' : 'var(--dash-red)',
          color: retrying ? 'var(--dash-text-tertiary)' : '#fff',
          fontSize: 12,
          fontWeight: 700,
          cursor: retrying ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {retrying ? 'Réessai…' : 'Réessayer'}
      </button>
    </div>
  );
}
