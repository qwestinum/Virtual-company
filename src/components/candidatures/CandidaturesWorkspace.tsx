'use client';

/**
 * Menu Candidatures — conteneur des 3 niveaux (liste + ruban → panneau →
 * page). Source de données : `/api/candidatures` (jamais le journal). Le ruban
 * (périmètre campagne+période) et la liste (tous filtres) viennent du hook
 * `useCandidatures`. Les options de campagne + le libellé « CAMP · poste »
 * viennent du store (le conteneur en est le propriétaire — la ligne, elle,
 * reste découplée et reçoit le libellé en prop).
 */

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  selectActiveCampaigns,
  useCampaignsStore,
} from '@/stores/campaigns-store';
import type { CandidateListItem } from '@/types/reporting';

import { CandidatureFullPage } from './CandidatureFullPage';
import { CandidaturePanel } from './CandidaturePanel';
import { CandidatureRow } from './CandidatureRow';
import { CandidaturesFilters, type PeriodKey } from './CandidaturesFilters';
import { CandidaturesRibbon } from './CandidaturesRibbon';
import {
  CANDIDATURES_PAGE_SIZE,
  NO_CAMPAIGN_IDS,
  useCandidatures,
} from './useCandidatures';

/** Borne basse (jour ISO) pour une fenêtre de N jours à partir de `ref`. */
function isoDayMinus(ref: Date, days: number): string {
  const d = new Date(ref);
  d.setDate(ref.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function CandidaturesWorkspace() {
  // `useShallow` OBLIGATOIRE : `selectActiveCampaigns` recrée un tableau à chaque
  // appel → sans comparaison superficielle, useSyncExternalStore boucle à
  // l'infini (« Maximum update depth exceeded »). Même pattern que CandidatesCard.
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));
  const { campaignOptions, labelOf, activeIds } = useMemo(() => {
    const opts = campaigns.map((c) => ({
      id: c.id,
      label: `${c.id} · ${c.fdp.fields.job_title?.value ?? 'Poste non précisé'}`,
    }));
    const map = new Map(opts.map((o) => [o.id, o.label]));
    return {
      campaignOptions: opts,
      labelOf: (id: string | null) => (id ? map.get(id) ?? id : null),
      activeIds: campaigns.filter((c) => c.status === 'active').map((c) => c.id),
    };
  }, [campaigns]);

  const {
    filters,
    setFilters,
    counts,
    rows,
    listTotal,
    loadingList,
    page,
    setPage,
    refresh,
  } = useCandidatures();

  const [panelItem, setPanelItem] = useState<CandidateListItem | null>(null);
  const [fullItem, setFullItem] = useState<CandidateListItem | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('all');
  const referenceDate = useMemo(() => new Date(), []);

  // Sélecteur campagne : 'all' | 'active' (ensemble) | <id> (campagne précise).
  const campaignValue =
    filters.campaignIds.length > 0 ? 'active' : filters.campaignId || 'all';
  const onCampaign = (v: string) => {
    if (v === 'active') setFilters({ campaignId: '', campaignIds: activeIds });
    else if (v === 'all')
      setFilters({ campaignId: '', campaignIds: NO_CAMPAIGN_IDS });
    else setFilters({ campaignId: v, campaignIds: NO_CAMPAIGN_IDS });
  };
  const onPeriod = (v: PeriodKey) => {
    setPeriod(v);
    if (v === 'all') setFilters({ from: '', to: '' });
    else setFilters({ from: isoDayMinus(referenceDate, Number(v)), to: '' });
  };

  // Une action ne ferme NI le panneau NI la page : on rafraîchit seulement la
  // liste + le ruban en arrière-plan (le panneau/la page re-fetchent leur propre
  // détail et mettent à jour l'étape + les actions proposées).
  const onActed = () => refresh();

  const pageCount = Math.max(1, Math.ceil(listTotal / CANDIDATURES_PAGE_SIZE));

  return (
    <div className="flex h-full bg-orqa-brume">
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="border-b border-orqa-ligne px-7 py-5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-fraunces text-[28px] font-semibold tracking-tight text-orqa-nuit">
              Candidatures
            </h1>
            <span className="font-data text-[13px] text-orqa-gris">
              {listTotal} candidature{listTotal > 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-4">
            <CandidaturesFilters
              campaignOptions={campaignOptions}
              activeCount={activeIds.length}
              campaignValue={campaignValue}
              onCampaign={onCampaign}
              search={filters.search}
              onSearch={(v) => setFilters({ search: v })}
              period={period}
              onPeriod={onPeriod}
              fromVivier={filters.fromVivier}
              onVivier={(b) => setFilters({ fromVivier: b })}
            />
          </div>
          <div className="mt-4">
            <CandidaturesRibbon
              counts={counts}
              active={filters.stage}
              onSelect={(stage) => setFilters({ stage })}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-7 py-5">
          {loadingList && rows.length === 0 ? (
            <p className="font-inter text-[13px] text-orqa-gris-clair">Chargement…</p>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-fraunces text-[19px] text-orqa-encre">
                Aucune candidature ne correspond
              </p>
              <p className="mt-1.5 font-inter text-[13px] text-orqa-gris">
                Ajustez les filtres ou l&apos;étape sélectionnée pour élargir la recherche.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((item) => (
                <li key={item.id}>
                  <CandidatureRow
                    item={item}
                    campaignLabel={labelOf(item.campaignId)}
                    selected={panelItem?.id === item.id}
                    onClick={() => setPanelItem(item)}
                  />
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <div className="mt-5 flex items-center justify-center gap-3 font-inter text-[12px]">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="rounded-[10px] border border-orqa-ligne bg-white px-3 py-1.5 font-medium text-orqa-encre transition hover:border-orqa-ciel disabled:opacity-40"
              >
                Précédent
              </button>
              <span className="font-data text-orqa-gris">
                Page {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(page + 1)}
                className="rounded-[10px] border border-orqa-ligne bg-white px-3 py-1.5 font-medium text-orqa-encre transition hover:border-orqa-ciel disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {panelItem ? (
        <CandidaturePanel
          item={panelItem}
          campaignLabel={labelOf(panelItem.campaignId)}
          onClose={() => setPanelItem(null)}
          onOpenFull={() => setFullItem(panelItem)}
          onActed={onActed}
        />
      ) : null}

      {fullItem ? (
        <CandidatureFullPage
          item={fullItem}
          onClose={() => setFullItem(null)}
          onActed={onActed}
        />
      ) : null}
    </div>
  );
}
