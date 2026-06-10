'use client';

/**
 * Sous-onglet « Rapport de campagne » (cf. docs/specs/reporting.md §3) : liste
 * filtrable des campagnes CLÔTURÉES, tri, pagination 20/page, génération PDF
 * (cache stable) et envoi mail. Filtrage / tri / pagination côté client
 * (volume MVP faible) via helpers purs.
 */

import { useEffect, useMemo, useState } from 'react';

import { CampaignReportCard } from '@/components/reporting/CampaignReportCard';
import { CampaignReportDetail } from '@/components/reporting/CampaignReportDetail';
import { CampaignReportFilters } from '@/components/reporting/CampaignReportFilters';
import type { DonneurOption } from '@/components/reporting/DonneurOrdreSelect';
import { SendReportModal } from '@/components/reporting/SendReportModal';
import { SentHistoryModal } from '@/components/reporting/SentHistoryModal';
import {
  campaignSendDefaults,
  filterCampaignSummaries,
  resultCountLabel,
  sortCampaignSummaries,
  type CampaignSortKey,
} from '@/lib/reporting/campaign-report-display';
import type { CampaignReportSummary } from '@/types/reporting';

const PAGE_SIZE = 20;

function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function CampaignReportList() {
  const [items, setItems] = useState<CampaignReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [donneurId, setDonneurId] = useState('');
  const [sortKey, setSortKey] = useState<CampaignSortKey>('closed_desc');
  const [page, setPage] = useState(0);
  const [referenceDate] = useState(() => new Date());
  const [sendTarget, setSendTarget] = useState<CampaignReportSummary | null>(null);
  const [historyTarget, setHistoryTarget] =
    useState<CampaignReportSummary | null>(null);
  const [detailTarget, setDetailTarget] =
    useState<CampaignReportSummary | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/reporting/campaigns');
      if (res.status === 503) {
        setOffline(true);
        setItems([]);
        return;
      }
      const data = await res.json();
      setOffline(false);
      setItems((data.campaigns as CampaignReportSummary[]) ?? []);
    } catch (err) {
      console.error('[campaign-report] list failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, []);

  // Tout changement de filtre/tri ramène à la première page (sans effet —
  // setState dans un effet déclenche des rendus en cascade).
  function setSearchReset(v: string) {
    setSearch(v);
    setPage(0);
  }
  function setPeriodReset(range: { from: string; to: string }) {
    setPeriod(range);
    setPage(0);
  }
  function setDonneurReset(id: string) {
    setDonneurId(id);
    setPage(0);
  }
  function setSortReset(key: CampaignSortKey) {
    setSortKey(key);
    setPage(0);
  }

  const donneurOptions = useMemo<DonneurOption[]>(() => {
    const by = new Map<string, string>();
    for (const it of items) {
      if (it.donneurOrdreId && it.donneurOrdre) {
        by.set(it.donneurOrdreId, it.donneurOrdre.label);
      }
    }
    return [...by.entries()].map(([id, label]) => ({ id, label }));
  }, [items]);

  const filtered = useMemo(
    () =>
      sortCampaignSummaries(
        filterCampaignSummaries(items, {
          search,
          from: period.from,
          to: period.to,
          donneurOrdreId: donneurId,
        }),
        sortKey,
      ),
    [items, search, period.from, period.to, donneurId, sortKey],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function regenerate(s: CampaignReportSummary) {
    const ok = window.confirm(
      `Régénérer le rapport de « ${s.jobTitle} » ? Le rapport en cache sera remplacé.`,
    );
    if (!ok) return;
    download(`/api/reporting/campaigns/${s.campaignId}/report?force=1`);
    window.setTimeout(() => void load(), 1500);
  }

  function generate(s: CampaignReportSummary) {
    download(`/api/reporting/campaigns/${s.campaignId}/report`);
    window.setTimeout(() => void load(), 1500);
  }

  if (offline) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-800">
        Supabase non configuré — aucune campagne persistée. Configurez la base
        pour activer les rapports de campagne.
      </p>
    );
  }

  // Modales partagées entre la liste et la vue détail.
  const modals = (
    <>
      {sendTarget ? (
        (() => {
          const defaults = campaignSendDefaults(sendTarget);
          return (
            <SendReportModal
              key={sendTarget.campaignId}
              open
              onClose={() => setSendTarget(null)}
              sendEndpoint={`/api/reporting/campaigns/${sendTarget.campaignId}/send`}
              attachmentName={defaults.attachmentName}
              defaultSubject={defaults.subject}
              defaultMessage={defaults.message}
              onSent={() => {
                window.setTimeout(() => void load(), 800);
              }}
            />
          );
        })()
      ) : null}
      {historyTarget ? (
        <SentHistoryModal
          open
          onClose={() => setHistoryTarget(null)}
          jobTitle={historyTarget.jobTitle}
          sends={historyTarget.sends}
        />
      ) : null}
    </>
  );

  // Vue détail (consultation du rapport à l'écran) au clic sur une carte.
  if (detailTarget) {
    return (
      <>
        <CampaignReportDetail
          summary={detailTarget}
          onBack={() => setDetailTarget(null)}
          onGenerate={() => generate(detailTarget)}
          onRegenerate={() => regenerate(detailTarget)}
          onSend={() => setSendTarget(detailTarget)}
        />
        {modals}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CampaignReportFilters
        search={search}
        onSearchChange={setSearchReset}
        period={period}
        onPeriodChange={setPeriodReset}
        referenceDate={referenceDate}
        donneurOrdreId={donneurId}
        onDonneurChange={setDonneurReset}
        donneurOptions={donneurOptions}
        sortKey={sortKey}
        onSortChange={setSortReset}
      />

      <p className="font-body text-[12px] font-semibold text-stone-500">
        {loading ? 'Chargement…' : resultCountLabel(filtered.length)}
      </p>

      {!loading && filtered.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center font-body text-[13px] text-stone-500">
          Aucune campagne clôturée ne correspond aux filtres.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {paged.map((s) => (
            <CampaignReportCard
              key={s.campaignId}
              summary={s}
              onOpen={() => setDetailTarget(s)}
              onGenerate={() => generate(s)}
              onRegenerate={() => regenerate(s)}
              onSend={() => setSendTarget(s)}
              onShowHistory={() => setHistoryTarget(s)}
            />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-3 font-body text-[13px]">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-stone-300 px-3 py-1 font-semibold text-stone-600 disabled:opacity-40 hover:bg-stone-50"
          >
            Précédent
          </button>
          <span className="text-stone-500">
            Page {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded-md border border-stone-300 px-3 py-1 font-semibold text-stone-600 disabled:opacity-40 hover:bg-stone-50"
          >
            Suivant
          </button>
        </div>
      ) : null}

      {modals}
    </div>
  );
}
