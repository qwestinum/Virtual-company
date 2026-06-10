'use client';

/**
 * Sous-onglet « Rapport multi-campagnes » (cf. docs/specs/reporting.md §4) :
 * sélection de période LIBRE (défaut « Ce mois ») + filtres, aperçu réactif
 * du périmètre, puis Générer / Envoyer. Génération PDF À LA VOLÉE (pas de
 * cache). Aperçu 100% client-side depuis un fetch unique des campagnes
 * clôturées (pas de saturation API).
 */

import { Download, Eye, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DonneurOrdreSelect } from '@/components/reporting/DonneurOrdreSelect';
import { MultiCampaignPreview } from '@/components/reporting/MultiCampaignPreview';
import { MultiCampaignReportDetail } from '@/components/reporting/MultiCampaignReportDetail';
import type { SelectOption } from '@/components/reporting/SearchableSelect';
import { SendReportModal } from '@/components/reporting/SendReportModal';
import { SiteSelect } from '@/components/reporting/SiteSelect';
import { PeriodFilter } from '@/components/reporting/PeriodFilter';
import { filterCampaignSummaries } from '@/lib/reporting/campaign-report-display';
import {
  MULTI_CAMPAIGN_PERIOD_PRESET_KEYS,
  defaultMultiCampaignPeriod,
  multiCampaignSendDefaults,
} from '@/lib/reporting/multi-campaign-report-display';
import type { CampaignReportSummary } from '@/types/reporting';

export function MultiCampaignReportView() {
  const [items, setItems] = useState<CampaignReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [referenceDate] = useState(() => new Date());
  const [period, setPeriod] = useState(() => defaultMultiCampaignPeriod(new Date()));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [donneurId, setDonneurId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/reporting/campaigns');
        if (res.status === 503) {
          setOffline(true);
          return;
        }
        const data = await res.json();
        setItems((data.campaigns as CampaignReportSummary[]) ?? []);
      } catch (err) {
        console.error('[multi-campaign] list failed', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Debounce 300ms de la recherche libre (filtrage client).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const donneurOptions = useMemo<SelectOption[]>(() => {
    const by = new Map<string, string>();
    for (const it of items) {
      if (it.donneurOrdreId && it.donneurOrdre) by.set(it.donneurOrdreId, it.donneurOrdre.label);
    }
    return [...by.entries()].map(([id, label]) => ({ id, label }));
  }, [items]);

  const siteOptions = useMemo<SelectOption[]>(() => {
    const by = new Map<string, string>();
    for (const it of items) if (it.siteId && it.siteLabel) by.set(it.siteId, it.siteLabel);
    return [...by.entries()].map(([id, label]) => ({ id, label }));
  }, [items]);

  const filtered = useMemo(
    () =>
      filterCampaignSummaries(items, {
        search,
        from: period.from,
        to: period.to,
        donneurOrdreId: donneurId,
        siteId,
      }),
    [items, search, period.from, period.to, donneurId, siteId],
  );

  function queryString(): string {
    const sp = new URLSearchParams();
    sp.set('from', period.from);
    sp.set('to', period.to);
    if (search.trim()) sp.set('search', search.trim());
    if (donneurId) sp.set('donneur', donneurId);
    if (siteId) sp.set('site', siteId);
    return sp.toString();
  }

  function generate() {
    const a = document.createElement('a');
    a.href = `/api/reporting/multi-campaigns/report?${queryString()}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const sendDefaults = multiCampaignSendDefaults(period, filtered.length, {
    search: search.trim() || null,
    donneurLabel: donneurOptions.find((o) => o.id === donneurId)?.label ?? null,
    siteLabel: siteOptions.find((o) => o.id === siteId)?.label ?? null,
  });
  const disabled = filtered.length === 0;

  if (offline) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-800">
        Supabase non configuré — aucune campagne persistée. Configurez la base
        pour activer les rapports multi-campagnes.
      </p>
    );
  }

  const sendModal = sendOpen ? (
    <SendReportModal
      open
      onClose={() => setSendOpen(false)}
      sendEndpoint={`/api/reporting/multi-campaigns/send?${queryString()}`}
      attachmentName={sendDefaults.attachmentName}
      defaultSubject={sendDefaults.subject}
      defaultMessage={sendDefaults.message}
    />
  ) : null;

  // Vue détail (consultation à l'écran avant génération / envoi).
  if (viewing) {
    return (
      <>
        <MultiCampaignReportDetail
          queryString={queryString()}
          onBack={() => setViewing(false)}
          onGenerate={generate}
          onSend={() => setSendOpen(true)}
        />
        {sendModal}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <PeriodFilter
          from={period.from}
          to={period.to}
          onChange={setPeriod}
          presetKeys={MULTI_CAMPAIGN_PERIOD_PRESET_KEYS}
          referenceDate={referenceDate}
        />
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Recherche
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.currentTarget.value)}
              placeholder="Poste, intitulé de campagne ou donneur d'ordre…"
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
            />
          </label>
          <DonneurOrdreSelect options={donneurOptions} value={donneurId} onChange={setDonneurId} />
          <SiteSelect options={siteOptions} value={siteId} onChange={setSiteId} />
        </div>
      </div>

      {loading ? (
        <p className="font-body text-[13px] text-stone-500">Chargement…</p>
      ) : (
        <MultiCampaignPreview summaries={filtered} />
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setViewing(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Visualiser le rapport
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Générer le rapport
        </button>
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Envoyer le rapport
        </button>
      </div>

      {sendModal}
    </div>
  );
}
