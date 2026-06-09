'use client';

/**
 * Sélection du candidat à auditer (cf. docs/specs/reporting.md §5.3) :
 * recherche libre + filtres (campagne, statut, période), liste filtrable
 * avec compteur. Le clic sur une ligne remonte l'id au parent.
 */

import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { formatFrDate } from '@/lib/reporting/audit-display';
import type { CandidateAnalysisSummary } from '@/types/reporting';
import { CANDIDATE_STATUS_LABELS, type CandidateStatus } from '@/types/scoring';

import { PeriodFilter } from './PeriodFilter';

export function CandidateSelectionPanel({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CandidateStatus | ''>('');
  const [campaignId, setCampaignId] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [items, setItems] = useState<CandidateAnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [referenceDate] = useState(() => new Date());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (period.from) params.set('from', period.from);
    if (period.to) params.set('to', period.to);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/reporting/audit/candidates?${params.toString()}`,
            { signal: controller.signal },
          );
          if (res.status === 503) {
            setOffline(true);
            setItems([]);
            return;
          }
          const data = await res.json();
          setOffline(false);
          setItems((data.candidates as CandidateAnalysisSummary[]) ?? []);
        } catch (err) {
          if (!controller.signal.aborted) console.error('[audit] list failed', err);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [search, status, period.from, period.to]);

  // Campagnes présentes dans le jeu courant (filtre client complémentaire).
  const campaigns = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) if (it.campaignId) ids.add(it.campaignId);
    return [...ids].sort();
  }, [items]);

  const visible = useMemo(
    () => (campaignId ? items.filter((it) => it.campaignId === campaignId) : items),
    [items, campaignId],
  );

  if (offline) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-800">
        Supabase non configuré — aucune analyse candidat persistée. Configurez la
        base pour activer l&apos;audit candidat.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2">
          <Search className="h-4 w-4 text-stone-400" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Nom, email ou numéro de candidature…"
            className="w-full bg-transparent font-body text-[13px] text-stone-800 outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Statut
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value as CandidateStatus | '')}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
            >
              <option value="">Tous</option>
              <option value="accepted">{CANDIDATE_STATUS_LABELS.accepted}</option>
              <option value="rejected">{CANDIDATE_STATUS_LABELS.rejected}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Campagne
            </span>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.currentTarget.value)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
            >
              <option value="">Toutes</option>
              {campaigns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PeriodFilter
          from={period.from}
          to={period.to}
          onChange={setPeriod}
          referenceDate={referenceDate}
        />
      </div>

      <p className="font-body text-[12px] font-semibold text-stone-500">
        {loading
          ? 'Chargement…'
          : `${visible.length} candidat${visible.length > 1 ? 's' : ''} analysé${
              visible.length > 1 ? 's' : ''
            }`}
      </p>

      {!loading && visible.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center font-body text-[13px] text-stone-500">
          Aucun candidat ne correspond aux filtres.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left hover:border-amber-300 hover:bg-amber-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-body text-[14px] font-semibold text-stone-800">
                    {it.candidateName}
                  </p>
                  <p className="truncate font-body text-[12px] text-stone-500">
                    {(it.candidateEmail ?? '— email manquant') +
                      ' · ' +
                      (it.campaignId ?? 'Hors campagne') +
                      ' · ' +
                      formatFrDate(it.receivedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-display text-[15px] font-bold text-stone-700">
                    {it.totalScore}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold text-white ${
                      it.status === 'accepted' ? 'bg-emerald-600' : 'bg-rose-600'
                    }`}
                  >
                    {CANDIDATE_STATUS_LABELS[it.status]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
