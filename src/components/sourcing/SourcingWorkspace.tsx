'use client';

/**
 * Onglet « Sourcing » — les campagnes actives, puis, pour l'une d'elles, la
 * requête et la liste des profils. Spec : docs/specs/sourcing.md §14.
 *
 * Lot 2 : lecture seule. Décliner, se connecter, contacter par email, badges
 * « en recherche » et mentions arrivent au lot 3.
 */

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { SourcingCampaignSummary } from '@/types/sourcing';

import { SourcingCampaignList } from './SourcingCampaignList';
import { SourcingCampaignView } from './SourcingCampaignView';

type Payload = { campaigns: SourcingCampaignSummary[]; myApproachesThisMonth: number };

export function SourcingWorkspace({
  initialCampaignId = null,
}: {
  /**
   * Campagne sur laquelle DÉPOSER d'emblée (`?campagne=…`).
   *
   * ⚠️ « Approcher des profils » depuis une carte de campagne nomme UNE
   * campagne : atterrir sur la liste de toutes les campagnes actives
   * obligerait à la retrouver dans une liste qu'on vient de quitter. La porte
   * dépose devant le geste ; la liste reste à un clic, au-dessus.
   */
  initialCampaignId?: string | null;
} = {}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialCampaignId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sourcing/campaigns', { cache: 'no-store' });
      if (!res.ok) {
        setError(res.status === 404 ? 'La recherche de profils n’est pas activée.' : 'Chargement impossible.');
        return;
      }
      setData((await res.json()) as Payload);
      setError(null);
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const open = data?.campaigns.find((c) => c.campaignId === openId) ?? null;

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        {open ? (
          <SourcingCampaignView
            campaign={open}
            onBack={() => {
              setOpenId(null);
              void load();
            }}
          />
        ) : (
          <>
            <header className="flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Recherche de profils
                </p>
                <h1 className="font-display text-3xl font-bold text-stone-900">Sourcing</h1>
                <p className="mt-2 max-w-2xl font-body text-[14px] text-stone-600">
                  Trouvez des profils professionnels publics pour une campagne active. Vous décidez
                  qui approcher ; rien n’est envoyé à leur place.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
                aria-label="Actualiser"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </header>
            {loading && !data ? (
              <p className="font-body text-[13px] text-stone-500">
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                Chargement…
              </p>
            ) : error ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[13px] text-amber-900">
                {error}
              </p>
            ) : data ? (
              <SourcingCampaignList
                campaigns={data.campaigns}
                myApproachesThisMonth={data.myApproachesThisMonth}
                onSource={setOpenId}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
