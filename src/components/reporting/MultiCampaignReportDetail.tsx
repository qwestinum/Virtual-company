'use client';

/**
 * Vue détail du rapport multi-campagnes, consultable À L'ÉCRAN avant de
 * décider de générer / envoyer (cf. docs/specs/reporting.md §4) — symétrique
 * du rapport de campagne. Reprend les sections du PDF (vue d'ensemble,
 * répartition par campagne, canaux, scoring, recommandations, RGPD). Lecture
 * seule ; charge les données via GET /api/reporting/multi-campaigns.
 */

import { ArrowLeft, Download, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatFrDate } from '@/lib/reporting/audit-display';
import { CAMPAIGN_ISSUE_LABELS } from '@/lib/reporting/campaign-report-display';
import type { MultiCampaignReportData } from '@/types/reporting';

export function MultiCampaignReportDetail({
  queryString,
  onBack,
  onGenerate,
  onSend,
}: {
  queryString: string;
  onBack: () => void;
  onGenerate: () => void;
  onSend: () => void;
}) {
  const [data, setData] = useState<MultiCampaignReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setData(null);
      setError(null);
      try {
        const res = await fetch(`/api/reporting/multi-campaigns?${queryString}`);
        if (cancelled) return;
        if (!res.ok) {
          setError('Rapport indisponible.');
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json.data as MultiCampaignReportData);
      } catch {
        if (!cancelled) setError('Erreur réseau.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la sélection
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Générer
          </button>
          <button
            type="button"
            onClick={onSend}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-amber-600"
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            Envoyer
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700">
          {error}
        </p>
      ) : !data ? (
        <p className="font-body text-[13px] text-stone-500">Préparation du rapport…</p>
      ) : (
        <Body data={data} />
      )}
    </div>
  );
}

function Body({ data }: { data: MultiCampaignReportData }) {
  const { aggregateVolumes, rates, channels, scoring } = data;
  const maxBucket = Math.max(1, ...scoring.distribution.map((b) => b.count));
  const filters = [
    data.filters.donneurLabel ? `Donneur : ${data.filters.donneurLabel}` : null,
    data.filters.siteLabel ? `Site : ${data.filters.siteLabel}` : null,
    data.filters.search ? `Recherche : « ${data.filters.search} »` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-display text-xl font-bold text-stone-900">
          Rapport multi-campagnes
        </h2>
        <p className="font-body text-[13px] text-stone-500">
          Du {formatFrDate(data.period.from)} au {formatFrDate(data.period.to)} ·{' '}
          {data.campaignCount} campagne{data.campaignCount > 1 ? 's' : ''}
        </p>
        {filters.length > 0 ? (
          <p className="mt-1 font-body text-[12px] text-stone-400">
            {filters.join(' · ')}
          </p>
        ) : null}
      </header>

      <Section title="Vue d'ensemble agrégée">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi n={aggregateVolumes.received} label="Reçues" />
          <Kpi n={aggregateVolumes.retained} label="Retenus" />
          <Kpi n={aggregateVolumes.rejected} label="Écartés" />
          <Kpi n={aggregateVolumes.enAttente} label="En attente" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi n={`${rates.retentionRate}%`} label="Taux de retenue" />
          <Kpi
            n={rates.avgTimeToHireDays !== null ? `${rates.avgTimeToHireDays} j` : '—'}
            label="Time-to-hire moyen"
            note="campagnes ayant recruté"
          />
          <Kpi n={`${Math.round(rates.humanValidationRate * 100)}%`} label="Validation humaine" />
          <Kpi n={`${rates.responseRate}%`} label="Taux de réponse" />
        </div>
      </Section>

      <Section title="Répartition par campagne">
        <table className="w-full font-body text-[12px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase text-stone-400">
              <th className="py-1">Campagne</th>
              <th className="py-1">Site</th>
              <th className="py-1 text-right">Durée</th>
              <th className="py-1 text-right">Reçu</th>
              <th className="py-1 text-right">Retenue</th>
              <th className="py-1 text-right">TTH</th>
              <th className="py-1">Issue</th>
            </tr>
          </thead>
          <tbody>
            {data.perCampaign.map((c) => (
              <tr key={c.campaignId} className="border-t border-stone-100">
                <td className="py-1">{c.jobTitle}</td>
                <td className="py-1">{c.siteLabel}</td>
                <td className="py-1 text-right">{c.durationDays} j</td>
                <td className="py-1 text-right">{c.received}</td>
                <td className="py-1 text-right">{c.retentionRate}%</td>
                <td className="py-1 text-right">
                  {c.timeToHireDays !== null ? `${c.timeToHireDays} j` : '—'}
                </td>
                <td className="py-1">{CAMPAIGN_ISSUE_LABELS[c.issue]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Performance par canal de diffusion">
        {channels.length === 0 ? (
          <p className="font-body text-[13px] text-stone-500">Aucun canal exploitable.</p>
        ) : (
          <table className="w-full font-body text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-stone-400">
                <th className="py-1">Canal</th>
                <th className="py-1 text-right">Volume</th>
                <th className="py-1 text-right">Taux retenue</th>
                <th className="py-1 text-right">Recrutés</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1">{c.channelLabel}</td>
                  <td className="py-1 text-right">{c.volume}</td>
                  <td className="py-1 text-right">{c.retentionRate}%</td>
                  <td className="py-1 text-right">{c.recruited}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.topChannelLabels.length > 0 ? (
          <p className="mt-2 font-body text-[12px] text-stone-500">
            Canal le plus performant : {data.topChannelLabels.join(', ')}.
          </p>
        ) : null}
        {data.underperformingChannelLabels.length > 0 ? (
          <p className="font-body text-[12px] text-stone-400">
            Canaux sans retenu : {data.underperformingChannelLabels.join(', ')}.
          </p>
        ) : null}
      </Section>

      <Section title="Analyse du scoring">
        <div className="flex flex-col gap-1.5">
          {scoring.distribution.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 font-body text-[12px] text-stone-500">{b.label}</span>
              <div className="h-2.5 flex-1 rounded bg-stone-100">
                <div
                  className="h-2.5 rounded bg-amber-400"
                  style={{ width: `${(b.count / maxBucket) * 100}%` }}
                />
              </div>
              <span className="w-6 text-right font-body text-[12px] text-stone-600">
                {b.count}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 font-body text-[12px] text-stone-500">
          Score moyen : {scoring.average ?? '—'} · écart-type :{' '}
          {scoring.stdDev ?? '—'} · arbitrage : {Math.round(scoring.humanValidationRate * 100)}%
        </p>
      </Section>

      <Section title="Enseignements et recommandations transverses">
        <ul className="flex flex-col gap-1.5">
          {data.recommendations.map((r, i) => (
            <li key={i} className="flex gap-2 font-body text-[13px] text-stone-700">
              <span className="font-bold text-amber-500">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Conformité et traçabilité">
        <p className="font-body text-[13px] text-stone-600">
          {data.rgpd.totalCandidates} candidats dans le périmètre. Conservation :{' '}
          {data.rgpd.retentionMonths} mois à compter de la clôture de chaque
          campagne. Actions tracées au journal d&apos;audit ORQA (usage interne / DPO).
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="mb-3 font-display text-[12px] font-bold uppercase tracking-wide text-amber-600">
        {title}
      </p>
      {children}
    </section>
  );
}

function Kpi({ n, label, note }: { n: number | string; label: string; note?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
      <p className="font-display text-[20px] font-bold text-stone-900">{n}</p>
      <p className="font-body text-[11px] uppercase text-stone-500">{label}</p>
      {note ? <p className="font-body text-[10px] text-stone-400">{note}</p> : null}
    </div>
  );
}
