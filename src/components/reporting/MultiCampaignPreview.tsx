'use client';

/**
 * Zone d'aperçu réactive du rapport multi-campagnes (cf. docs/specs/reporting.md
 * §4.4) : compteur, 3 chiffres-clés agrégés et liste compacte (10 max). Permet
 * de valider le périmètre avant génération. Lecture seule, 100% dérivé des
 * résumés déjà chargés (aucun appel réseau).
 */

import { formatFrDate } from '@/lib/reporting/audit-display';
import {
  CAMPAIGN_ISSUE_LABELS,
  donneurOrdreLabel,
  resultCountLabel,
} from '@/lib/reporting/campaign-report-display';
import { aggregatePreview } from '@/lib/reporting/multi-campaign-report';
import type { CampaignReportSummary } from '@/types/reporting';

const MAX_ROWS = 10;

export function MultiCampaignPreview({
  summaries,
}: {
  summaries: CampaignReportSummary[];
}) {
  const preview = aggregatePreview(summaries);

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-6 text-center">
        <p className="font-body text-[13px] text-stone-600">
          Aucune campagne clôturée sur la période sélectionnée.
        </p>
        <p className="mt-1 font-body text-[12px] text-stone-400">
          Élargissez la période ou assouplissez les filtres.
        </p>
      </div>
    );
  }

  const shown = summaries.slice(0, MAX_ROWS);
  const extra = summaries.length - shown.length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <p className="font-body text-[12px] font-semibold text-stone-500">
        {resultCountLabel(summaries.length)}
      </p>

      {summaries.length === 1 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 font-body text-[12px] text-amber-800">
          Une seule campagne clôturée sur cette période. Vous pouvez générer le
          rapport multi-campagnes ou utiliser le sous-onglet « Rapport de
          campagne » pour plus de détails.
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Kpi n={preview.totalReceived} label="Candidatures" />
        <Kpi n={preview.totalRetained} label="Retenus" />
        <Kpi n={preview.totalRecruited} label="Recrutements" />
      </div>

      <ul className="flex flex-col divide-y divide-stone-100">
        {shown.map((s) => (
          <li
            key={s.campaignId}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate font-body text-[13px] font-semibold text-stone-800">
                {s.jobTitle}
              </p>
              <p className="truncate font-body text-[11px] text-stone-500">
                {donneurOrdreLabel(s)} · {s.siteLabel ?? '—'} ·{' '}
                {formatFrDate(s.closedAt)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-body text-[10px] font-semibold ${
                s.issue === 'recruited'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-stone-100 text-stone-500'
              }`}
            >
              {CAMPAIGN_ISSUE_LABELS[s.issue]}
            </span>
          </li>
        ))}
      </ul>
      {extra > 0 ? (
        <p className="font-body text-[12px] text-stone-400">+ {extra} autres</p>
      ) : null}
    </div>
  );
}

function Kpi({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-center">
      <p className="font-display text-[20px] font-bold text-stone-900">{n}</p>
      <p className="font-body text-[11px] uppercase text-stone-500">{label}</p>
    </div>
  );
}
