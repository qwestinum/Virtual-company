'use client';

import { ArrowLeft } from 'lucide-react';
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

  return (
    <>
      <header className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1 font-body text-[12px] font-semibold text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Campagnes actives
        </button>
        <h1 className="font-display text-2xl font-bold text-stone-900">
          Sourcer — <span className="font-data text-stone-600">{campaign.campaignId}</span> {campaign.name}
        </h1>
        <p className="font-body text-[12px] text-stone-500">
          <ReferentMention referent={campaign.referent} />
        </p>
      </header>
      <SourcingQueryPanel campaignId={campaign.campaignId} onSearched={() => setVersion((v) => v + 1)} />
      <SourcingResults campaignId={campaign.campaignId} version={version} />
    </>
  );
}
