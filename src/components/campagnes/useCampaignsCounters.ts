'use client';

/**
 * Les compteurs de TOUTES les cartes affichées — UN appel, avec la liste.
 *
 * ⚠️ C'est une décision de latence. Les charger au dépliage faisait apparaître
 * les chiffres après les cartes, sur un écran dont c'est la première
 * information ; un appel par carte aurait fait quinze lectures là où une
 * suffit.
 *
 * Indexé sur la LISTE des identifiants affichés, pas sur la page : changer de
 * filtre ou de page relit, rouvrir une carte non. Best-effort — une panne
 * laisse les cartes sans chiffres, jamais sans cartes.
 */

import { useCallback, useEffect, useState } from 'react';

import type { CampaignCardCounters } from './CampaignCardDetail';

export function useCampaignsCounters(
  campaignIds: readonly string[],
): Record<string, CampaignCardCounters> {
  const [byCampaign, setByCampaign] = useState<
    Record<string, CampaignCardCounters>
  >({});
  // Clé stable : deux rendus avec les mêmes identifiants ne relisent pas.
  const cle = [...campaignIds].sort().join(',');

  const charger = useCallback(async () => {
    if (cle.length === 0) {
      setByCampaign({});
      return;
    }
    try {
      const res = await fetch(
        `/api/campaigns/counters?campaignIds=${encodeURIComponent(cle)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        byCampaign?: Record<string, CampaignCardCounters>;
      };
      setByCampaign(json.byCampaign ?? {});
    } catch {
      // Silencieux : les cartes restent lisibles sans leurs chiffres.
    }
  }, [cle]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
  }, [charger]);

  return byCampaign;
}
