'use client';

/**
 * Vue détaillée d'un audit candidat (cf. docs/specs/reporting.md §5.3) :
 * profil, grille de scoring appliquée critère-par-critère (verdict, citation,
 * poids, contribution), score global, statut, historique. Boutons Générer
 * (téléchargement PDF) / Envoyer (modale) en bas à droite.
 */

import { Download, Loader2, Send } from 'lucide-react';
import { useState } from 'react';

import {
  LLM_DECISION_COLORS,
  LLM_DECISION_LABELS,
  auditCandidatFileName,
  buildCandidateHistory,
  formatFrDate,
  formatFrDateTime,
  sortByCriticality,
} from '@/lib/reporting/audit-display';
import type { CandidateAnalysisDetail } from '@/types/reporting';
import {
  CANDIDATE_STATUS_LABELS,
  SCORING_LEVEL_LABELS,
} from '@/types/scoring';

import { SendReportModal } from './SendReportModal';

export function CandidateAuditDetail({
  detail,
}: {
  detail: CandidateAnalysisDetail;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { application } = detail;
  const { candidate, scoringResult, narration } = application;
  const ordered = sortByCriticality(scoringResult.breakdown);
  const history = buildCandidateHistory(detail);
  const accepted = scoringResult.status === 'accepted';
  const reportEndpoint = `/api/reporting/audit/candidates/${detail.id}/report`;
  // Nom indicatif — le serveur recalcule la date réelle à la génération.
  const todayIso = formatFrDate(detail.computedAt); // affichage seulement
  const attachmentName = auditCandidatFileName(
    detail.candidateName,
    detail.computedAt,
  );

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(reportEndpoint);
      if (!res.ok) {
        console.error('[audit] download failed', res.status);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachmentName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[audit] download error', err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* En-tête : identité + score */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-stone-900">
              {candidate.fullName}
            </h2>
            <p className="font-body text-[12px] text-stone-500">
              {detail.campaignId
                ? `Campagne ${detail.campaignId}`
                : 'Hors campagne'}{' '}
              · Candidature {detail.id}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-display text-3xl font-bold text-stone-900">
              {scoringResult.totalScore}
              <span className="text-base text-stone-400">/100</span>
            </span>
            <span
              className={`rounded-full px-3 py-1 font-body text-[12px] font-semibold text-white ${
                accepted ? 'bg-emerald-600' : 'bg-rose-600'
              }`}
            >
              {CANDIDATE_STATUS_LABELS[scoringResult.status]}
            </span>
          </div>
        </div>
        <p className="mt-3 font-body text-[13px] text-stone-600">
          {narration.justification}
        </p>
      </div>

      {/* Profil */}
      <Section title="Profil du candidat">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Meta label="Email" value={candidate.email ?? '— manquant'} />
          <Meta label="Téléphone" value={candidate.phone ?? '—'} />
          <Meta label="Localisation" value={candidate.location ?? '—'} />
          <Meta label="Canal" value={candidate.source} />
          <Meta label="Reçu le" value={formatFrDate(candidate.receivedAt)} />
          <Meta label="Grille" value={scoringResult.criteriaVersion} />
        </div>
        <p className="mt-3 font-body text-[13px] text-stone-700">
          {narration.summary}
        </p>
      </Section>

      {/* Grille critère par critère */}
      <Section title="Grille de scoring — critère par critère">
        <ul className="flex flex-col divide-y divide-stone-100">
          {ordered.map((b, i) => (
            <li key={`${b.criterionId}-${i}`} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-body text-[14px] font-semibold text-stone-800">
                  {b.criterionLabel}
                </p>
                <span
                  className="shrink-0 font-body text-[12px] font-bold"
                  style={{ color: LLM_DECISION_COLORS[b.llmDecision] }}
                >
                  {LLM_DECISION_LABELS[b.llmDecision]}
                </span>
              </div>
              <p className="font-body text-[11px] text-stone-500">
                {SCORING_LEVEL_LABELS[b.criticityLevel]} · poids {b.weight} ·
                contribution {b.contribution > 0 ? '+' : ''}
                {b.contribution} pts
              </p>
              {b.llmCVQuote ? (
                <p className="mt-1 border-l-2 border-stone-200 pl-2 font-body text-[12px] italic text-stone-600">
                  « {b.llmCVQuote} »
                </p>
              ) : null}
              <p className="mt-1 font-body text-[12px] text-stone-600">
                {b.llmJustification}
              </p>
            </li>
          ))}
        </ul>
        {scoringResult.hardFailures.length > 0 ? (
          <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2">
            <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-rose-700">
              Échecs sur critères durs
            </p>
            <ul className="mt-1 list-disc pl-5 font-body text-[12px] text-rose-700">
              {scoringResult.hardFailures.map((h, i) => (
                <li key={`${h.criterionId}-${i}`}>
                  {h.criterionLabel} —{' '}
                  {h.reason === 'unsatisfied' ? 'non satisfait' : 'non vérifiable'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {/* Historique */}
      <Section title="Historique des actions">
        <ul className="flex flex-col gap-2">
          {history.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-40 shrink-0 font-body text-[11px] text-stone-400">
                {formatFrDateTime(e.at)}
              </span>
              <div>
                <p className="font-body text-[13px] font-semibold text-stone-700">
                  {e.label}
                </p>
                {e.detail ? (
                  <p className="font-body text-[12px] text-stone-500">{e.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="font-body text-[11px] text-stone-400">
          Analyse calculée le {todayIso}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-4 py-2 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            Générer le rapport
          </button>
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-body text-[13px] font-semibold text-white hover:bg-amber-600"
          >
            <Send className="h-4 w-4" aria-hidden />
            Envoyer le rapport
          </button>
        </div>
      </div>

      <SendReportModal
        key={sendOpen ? `open-${detail.id}` : 'closed'}
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        sendEndpoint={`/api/reporting/audit/candidates/${detail.id}/send`}
        attachmentName={attachmentName}
        defaultSubject={`Audit candidat — ${detail.candidateName}`}
        defaultMessage={`Bonjour,\n\nVeuillez trouver ci-joint le rapport d'audit du candidat ${detail.candidateName}.\n\nCordialement,\nORQA`}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <h3 className="mb-3 font-display text-[12px] font-bold uppercase tracking-wide text-amber-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body text-[10px] uppercase tracking-wide text-stone-400">
        {label}
      </p>
      <p className="font-body text-[13px] text-stone-800">{value}</p>
    </div>
  );
}
