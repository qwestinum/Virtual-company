'use client';

/**
 * Carte d'une campagne clôturée (cf. docs/specs/reporting.md §3.3). Lisible en
 * 5 s : titre + issue, période/durée, donneur/site, volumes, mentions cache /
 * envois, actions Générer / Envoyer (+ menu Régénérer). Lecture seule.
 */

import { Download, MoreVertical, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';

import { formatFrDate } from '@/lib/reporting/audit-display';
import {
  CAMPAIGN_ISSUE_LABELS,
  donneurOrdreLabel,
  generatedMention,
  sentMention,
} from '@/lib/reporting/campaign-report-display';
import type { CampaignReportSummary } from '@/types/reporting';

export function CampaignReportCard({
  summary,
  onGenerate,
  onRegenerate,
  onSend,
  onShowHistory,
}: {
  summary: CampaignReportSummary;
  onGenerate: () => void;
  onRegenerate: () => void;
  onSend: () => void;
  onShowHistory: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { volumes } = summary;
  const sent = sentMention(summary);
  const generated = generatedMention(summary);
  const recruited = summary.issue === 'recruited';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-bold text-stone-900">
            {summary.jobTitle}
            <span className="ml-2 font-body text-[12px] font-normal text-stone-400">
              {summary.campaignId}
            </span>
          </p>
          <p className="font-body text-[12px] text-stone-500">
            {formatFrDate(summary.launchedAt)} → {formatFrDate(summary.closedAt)}{' '}
            · {summary.durationDays} jours
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

      <p className="font-body text-[12px] text-stone-600">
        Donneur d&apos;ordre : {donneurOrdreLabel(summary)} · Site :{' '}
        {summary.siteLabel ?? '—'}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-1 font-body text-[12px] text-stone-700">
        <Vol label="Reçues" n={volumes.received} />
        <Vol label="Retenus" n={volumes.retained} />
        <Vol label="Écartés" n={volumes.rejected} />
        <Vol label="Arbitrés" n={volumes.arbitrated} />
      </div>

      {(sent || generated) && (
        <div className="flex flex-wrap items-center gap-x-3 font-body text-[11px] text-stone-400">
          {sent ? (
            <button
              type="button"
              onClick={onShowHistory}
              className="underline-offset-2 hover:text-stone-600 hover:underline"
            >
              {sent}
            </button>
          ) : null}
          {generated ? <span>{generated}</span> : null}
        </div>
      )}

      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Générer le rapport
        </button>
        <button
          type="button"
          onClick={onSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-amber-600"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Envoyer
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"
            aria-label="Plus d'options"
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRegenerate();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-body text-[13px] text-stone-700 hover:bg-stone-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Régénérer
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Vol({ label, n }: { label: string; n: number }) {
  return (
    <span>
      <span className="font-semibold text-stone-900">{n}</span> {label}
    </span>
  );
}
