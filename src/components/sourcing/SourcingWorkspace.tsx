'use client';

/**
 * Onglet « Sourcing » — les campagnes actives, puis, pour l'une d'elles, la
 * requête et la liste des profils. Spec : docs/specs/sourcing.md §14.
 *
 * Lot 2 : lecture seule. Décliner, se connecter, contacter par email, badges
 * « en recherche » et mentions arrivent au lot 3.
 */

import { PageShell } from '@/components/navigation/PageShell';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { useReferentContext } from '@/components/referent/useReferentContext';
import { useReferentFilter } from '@/components/referent/useReferentFilter';
import {
  buildReferentOptionsBy,
  filterByReferentBy,
  myReferentCountBy,
} from '@/lib/referent/filter';
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

  // ⚠️ LE MÊME FILTRE, AU MÊME ENDROIT que sur les autres écrans, et le MÊME
  // ÉTAT : cocher « Mes campagnes » ici, c'est le retrouver coché ailleurs.
  // Le référent vient de la LIGNE (l'API le sert déjà) — pas besoin du
  // référentiel complet.
  const { currentUserId } = useReferentContext();
  const [referentFilter, setReferentFilter] = useReferentFilter(currentUserId);
  const toutes = useMemo(() => data?.campaigns ?? [], [data]);
  const referentDe = (c: SourcingCampaignSummary) => c.referent;
  const referentOptions = useMemo(
    () => buildReferentOptionsBy(toutes, referentDe),
    [toutes],
  );
  const myCount = useMemo(
    () => myReferentCountBy(toutes, referentDe, currentUserId),
    [toutes, currentUserId],
  );
  const visibles = useMemo(
    () => filterByReferentBy(toutes, referentDe, referentFilter),
    [toutes, referentFilter],
  );

  return (
    // ⚠️ GABARIT COMMUN (même constat qu'Entretiens : 896 px au lieu de 1400).
    // Le TITRE vient du gabarit : posé dans le contenu, il tombait 20 px plus
    // bas que sur les autres écrans.
    <PageShell title="Sourcing">
      <div className="flex w-full flex-col gap-5">
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
                <p className="max-w-2xl font-body text-[14px] text-stone-600">
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
            <ReferentFilterBar
              options={referentOptions}
              selection={referentFilter}
              onChange={setReferentFilter}
              myCount={myCount}
              currentUserId={currentUserId}
            />
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
                campaigns={visibles}
                myApproachesThisMonth={data.myApproachesThisMonth}
                onSource={setOpenId}
              />
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
