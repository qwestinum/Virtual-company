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
        {/* ⚠️ L'identifiant et l'intitulé sont DEUX choses : collés, on lisait
            « CAMP-2026-095développeur back end » d'un seul tenant. Un séparateur
            et de l'air entre les deux. */}
        <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-bold" style={{ color: 'var(--dash-text)' }}>
          <span>{sourced ? 'Sourcing' : 'Sourcer'}</span>
          <span className="font-data text-[18px] font-semibold" style={{ color: 'var(--dash-text-secondary)' }}>
            {campaign.campaignId}
          </span>
          <span>{campaign.name}</span>
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
          // ⚠️ Beige, plus noir : le noir plein n'existe nulle part ailleurs
          // dans le produit, et il donnait à « relancer » le poids d'une
          // action principale alors qu'on vient juste de consulter.
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-[12.5px] font-semibold"
          style={{
            borderColor: 'var(--dash-beige-bord)',
            background: 'var(--dash-beige)',
            color: 'var(--dash-beige-encre)',
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Relancer une recherche
        </button>
      )}
      <SourcingResults campaignId={campaign.campaignId} version={version} />
    </>
  );
}
