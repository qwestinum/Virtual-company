'use client';

/**
 * Vue détail d'un rapport de campagne, consultable À L'ÉCRAN au clic sur une
 * carte (cf. docs/specs/reporting.md §3) — en plus de Générer / Envoyer.
 * Reprend les sections du PDF (synthèse, performances, canaux, scoring,
 * recommandations, RGPD). Lecture seule ; charge les données via GET [id].
 */

import { ArrowLeft, Download, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatFrDate } from '@/lib/reporting/audit-display';
import {
  CAMPAIGN_ISSUE_LABELS,
  donneurOrdreLabel,
} from '@/lib/reporting/campaign-report-display';
import type {
  CampaignReportData,
  CampaignReportSummary,
} from '@/types/reporting';

export function CampaignReportDetail({
  summary,
  onBack,
  onGenerate,
  onRegenerate,
  onSend,
}: {
  summary: CampaignReportSummary;
  onBack: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onSend: () => void;
}) {
  const [data, setData] = useState<CampaignReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/reporting/campaigns/${summary.campaignId}`);
        if (!res.ok) {
          setError('Rapport indisponible.');
          return;
        }
        const json = await res.json();
        setData(json.data as CampaignReportData);
      } catch {
        setError('Erreur réseau.');
      }
    })();
  }, [summary.campaignId]);

  const recruited = summary.issue === 'recruited';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour aux campagnes
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
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Régénérer
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

      <header className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-stone-900">
              {summary.jobTitle}
            </h2>
            <p className="font-body text-[13px] text-stone-500">
              {summary.campaignName} · {summary.campaignId}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold ${
              recruited
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-stone-100 text-stone-500'
            }`}
          >
            {recruited
              ? `${CAMPAIGN_ISSUE_LABELS.recruited} (${summary.recruitedCount})`
              : CAMPAIGN_ISSUE_LABELS.no_hire}
          </span>
        </div>
        <p className="mt-2 font-body text-[13px] text-stone-600">
          {formatFrDate(summary.launchedAt)} → {formatFrDate(summary.closedAt)} ·{' '}
          {summary.durationDays} jours · Donneur d&apos;ordre :{' '}
          {donneurOrdreLabel(summary)} · Site : {summary.siteLabel ?? '—'}
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700">
          {error}
        </p>
      ) : !data ? (
        <p className="font-body text-[13px] text-stone-500">Chargement du rapport…</p>
      ) : (
        <CampaignReportBody data={data} />
      )}
    </div>
  );
}

function CampaignReportBody({ data }: { data: CampaignReportData }) {
  const { summary, performance, channels, scoring } = data;
  const maxBucket = Math.max(1, ...scoring.distribution.map((b) => b.count));
  return (
    <div className="flex flex-col gap-5">
      {data.lowVolume ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 font-body text-[12px] font-semibold text-amber-800">
          Moins de 5 candidatures traitées — statistiques peu significatives.
        </p>
      ) : null}

      <Section title="Synthèse du déroulé">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi n={summary.volumes.received} label="Reçues" />
          <Kpi n={summary.volumes.retained} label="Retenues" />
          <Kpi n={summary.volumes.rejected} label="Écartées" />
          <Kpi n={summary.volumes.arbitrated} label="Arbitrées" />
        </div>
      </Section>

      <Section title="Performance globale">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi n={`${performance.retentionRate}%`} label="Taux de retenue" />
          <Kpi
            n={performance.timeToHireDays !== null ? `${performance.timeToHireDays} j` : '—'}
            label="Time-to-hire"
          />
          <Kpi n={`${Math.round(performance.arbitrationRate * 100)}%`} label="Arbitrage" />
          <Kpi n={`${performance.responseRate}%`} label="Taux de réponse" />
        </div>
      </Section>

      <Section title="Performance par canal de réception">
        {channels.length === 0 ? (
          <p className="font-body text-[13px] text-stone-500">Aucun canal exploitable.</p>
        ) : (
          <table className="w-full font-body text-[13px]">
            <thead>
              <tr className="text-left font-semibold uppercase text-[11px] text-stone-400">
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
      </Section>

      <Section title="Synthèse du scoring">
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
          {scoring.stdDev ?? '—'} · cas arbitrés :{' '}
          {Math.round(scoring.arbitrationRate * 100)}%
        </p>
      </Section>

      <Section title="Enseignements et recommandations">
        <ul className="flex flex-col gap-1.5">
          {data.recommendations.map((r, i) => (
            <li key={i} className="flex gap-2 font-body text-[13px] text-stone-700">
              <span className="font-bold text-amber-500">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Conformité RGPD">
        <p className="font-body text-[13px] text-stone-600">
          Conservation : {data.rgpd.retentionMonths} mois. Suppression planifiée
          le {formatFrDate(data.rgpd.plannedDeletionAt)}. Actions tracées au
          journal d&apos;audit ORQA (usage interne / DPO).
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

function Kpi({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
      <p className="font-display text-[20px] font-bold text-stone-900">{n}</p>
      <p className="font-body text-[11px] uppercase text-stone-500">{label}</p>
    </div>
  );
}
