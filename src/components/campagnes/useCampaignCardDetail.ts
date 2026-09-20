'use client';

/**
 * Le contenu de la carte DÉPLIÉE — lu SEULEMENT au dépliage.
 *
 * ⚠️ `enabled` est la garantie, et elle est structurelle : le `fetch` ne part
 * que quand la carte est ouverte. Une liste de quinze campagnes ne déclenche
 * donc AUCUNE lecture — une par carte aurait fait quinze fois cinq requêtes
 * pour un écran qui n'en montre qu'une dépliée à la fois.
 *
 * Et comme la liste n'ouvre qu'une carte à la fois (`expandedId`), il y a au
 * plus UNE lecture en vol.
 *
 * Best-effort : une panne laisse la carte sans son détail, jamais sans sa
 * carte. Les chiffres absents ne s'inventent pas — ils ne s'affichent pas.
 */

import { useCallback, useEffect, useState } from 'react';

import type { CandidateStageCounts } from '@/lib/reporting/candidate-stage';

export type CampaignCardDetailData = {
  counts: CandidateStageCounts;
  received: number;
  awaiting: {
    aValider: number;
    aValiderOldestDays: number | null;
    entretiensAConfirmer: number;
  };
  sources: {
    isDraft: boolean;
    sourcingEnabled: boolean;
    annonce: string;
    vivier: string;
    approches: string;
  };
};

export type DetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: CampaignCardDetailData }
  | { kind: 'error' };

export function useCampaignCardDetail(
  campaignId: string,
  enabled: boolean,
): DetailState {
  const [state, setState] = useState<DetailState>({ kind: 'idle' });

  const charger = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/card`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setState({ kind: 'error' });
        return;
      }
      setState({ kind: 'ready', data: (await res.json()) as CampaignCardDetailData });
    } catch {
      setState({ kind: 'error' });
    }
  }, [campaignId]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
  }, [enabled, charger]);

  // Refermée : on oublie, PENDANT LE RENDU plutôt que dans un effet. Les
  // compteurs d'une carte qu'on rouvre ne doivent jamais dater d'une ouverture
  // précédente — et un effet les laisserait visibles une frame de trop.
  if (!enabled && state.kind !== 'idle') return { kind: 'idle' };

  return state;
}
