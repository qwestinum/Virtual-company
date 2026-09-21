'use client';

import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { ReferentMention } from '@/components/referent/ReferentMention';
import type { SourcingCampaignSummary } from '@/types/sourcing';

import { SourcingQueryPanel } from './SourcingQueryPanel';
import { SourcingResults } from './SourcingResults';

export function SourcingCampaignView({
  campaign,
  onBack,
}: {
  campaign: SourcingCampaignSummary;
  onBack: () => void;
}) {
  // Incrémenté après chaque recherche : la liste se recharge.
  const [version, setVersion] = useState(0);
  // Campagne déjà sourcée : on atterrit sur les RÉSULTATS. L'écran de requête
  // (qui rédige une requête au montage) ne s'ouvre qu'à « Relancer ».
  const sourced = campaign.lastSearchAt !== null;
  const [querying, setQuerying] = useState(!sourced);

  return (
    <>
      <header className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1 font-body text-[12px] font-semibold text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voir le sourcing de toutes les
          campagnes actives
        </button>
        <h1 className="font-display text-2xl font-bold text-stone-900">
          {sourced ? 'Sourcing' : 'Sourcer'} — <span className="font-data text-stone-600">{campaign.campaignId}</span> {campaign.name}
        </h1>
        <p className="font-body text-[12px] text-stone-500">
          <ReferentMention referent={campaign.referent} />
        </p>
      </header>
      {querying ? (
        <div className="flex flex-col gap-2">
          {sourced ? (
            <button type="button" onClick={() => setQuerying(false)} className="self-end font-body text-[12px] font-semibold text-stone-500 hover:text-stone-800">
              Fermer la recherche
            </button>
          ) : null}
          <SourcingQueryPanel campaignId={campaign.campaignId} onSearched={() => setVersion((v) => v + 1)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setQuerying(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-800"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Relancer une recherche
        </button>
      )}
      <SourcingResults campaignId={campaign.campaignId} version={version} />
    </>
  );
}
