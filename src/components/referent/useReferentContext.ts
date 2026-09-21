'use client';

/**
 * Le référent de chaque campagne + l'identité de session, pour les écrans qui
 * ne les reçoivent pas déjà dans leur propre réponse.
 *
 * Une seule requête pour toute la page (`dedupeFetch` : deux composants qui la
 * demandent en même temps n'en déclenchent qu'une). FAIL-SOFT : une panne rend
 * un contexte vide — aucun référent, pas de raccourci « Mes campagnes » — et
 * la liste s'affiche entière. Le filtre ne doit jamais emporter les dossiers.
 */

import { useEffect, useState } from 'react';

import { dedupeFetch } from '@/lib/net/dedupe-fetch';
import type { ReferentByCampaign } from '@/lib/referent/filter';

export type ReferentContextView = {
  referents: ReferentByCampaign;
  currentUserId: string | null;
};

const VIDE: ReferentContextView = { referents: {}, currentUserId: null };

export function useReferentContext(): ReferentContextView {
  const [view, setView] = useState<ReferentContextView>(VIDE);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const res = await dedupeFetch('/api/referent/context');
        const data = (await res.json()) as {
          referentByCampaign?: ReferentByCampaign;
          currentUserId?: string | null;
        };
        if (!vivant) return;
        setView({
          referents: data.referentByCampaign ?? {},
          currentUserId: data.currentUserId ?? null,
        });
      } catch {
        // Contexte vide : la liste reste entière.
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  return view;
}
