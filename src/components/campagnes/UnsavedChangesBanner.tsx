'use client';

/**
 * Bannière « modifications non enregistrées » (anti-perte silencieuse).
 *
 * Les éditions de campagne sont en autosave : un push de fond peut échouer
 * (réseau/serveur). Plutôt que de perdre la modif en silence au reload, on la
 * signale ici et on offre un réessai. Affichée seulement s'il y a au moins une
 * campagne en échec de synchro.
 */

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { retryFailedCampaignPushes } from '@/lib/db/sync/campaigns-sync';
import { useSyncStatusStore } from '@/stores/sync-status-store';

export function UnsavedChangesBanner() {
  const failed = useSyncStatusStore(
    useShallow((s) => Object.values(s.failedCampaigns)),
  );
  const [retrying, setRetrying] = useState(false);

  if (failed.length === 0) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retryFailedCampaignPushes();
    } finally {
      setRetrying(false);
    }
  };

  const names = failed
    .map((c) => `« ${c.name} »`)
    .slice(0, 3)
    .join(', ');
  const extra = failed.length > 3 ? ` et ${failed.length - 3} autre(s)` : '';

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
          {failed.length === 1
            ? 'Une modification n’a pas pu être enregistrée'
            : `${failed.length} modifications n’ont pas pu être enregistrées`}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
            marginTop: 1,
          }}
        >
          {names}
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
