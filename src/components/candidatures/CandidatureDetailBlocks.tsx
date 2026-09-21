'use client';

/**
 * Blocs de présentation ORQA du détail candidat (niveau 3). PRÉSENTATIONNELS :
 * toute la logique vient de helpers PURS réutilisés (`journeyColumns`,
 * `sortByCriticality`, `formatCriterionMethod`) — on ne re-dérive rien, on ne
 * fait que peindre à l'identité ORQA (distincte de l'onglet Audit).
 */

import {
  type CandidateJourney,
  journeyColumns,
} from '@/lib/reporting/candidate-journey';
import type { TimelineEvent, TimelineTone } from '@/lib/reporting/candidate-timeline';
import {
  formatCriterionMethod,
  formatFrDateTime,
  sortByCriticality,
} from '@/lib/reporting/audit-display';
import { openSignedArtifact } from '@/lib/storage/open-signed-artifact';
import type { CriterionDecision, LlmDecision } from '@/types/scoring';

/**
 * Ouvre le rapport d'analyse (PDF d'audit) EN INLINE dans un nouvel onglet.
 * L'endpoint sert le PDF en `attachment` (téléchargement) ; on le récupère en
 * blob et on ouvre l'URL blob → la visionneuse PDF du navigateur l'AFFICHE au
 * lieu de l'enregistrer. Popup-safe : fenêtre ouverte AVANT l'await.
 */
async function openReportInline(analysisId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = window.open('about:blank', '_blank');
  try {
    const res = await fetch(
      `/api/reporting/audit/candidates/${encodeURIComponent(analysisId)}/report`,
    );
    if (!res.ok) {
      win?.close();
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    win?.close();
  }
}

/**
 * Pièces du dossier : CV (lien signé à la demande) + Rapport d'analyse (PDF
 * d'audit généré à la volée, ouvert en inline). Mêmes pièces niveau 2 et 3.
 */
export function DetailPieces({
  analysisId,
  cvArtifactId,
}: {
  analysisId: string;
  cvArtifactId: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {cvArtifactId ? (
        <PieceButton onClick={() => void openSignedArtifact(cvArtifactId)}>
          📎 Voir le CV
        </PieceButton>
      ) : null}
      <PieceButton onClick={() => void openReportInline(analysisId)}>
        📄 Rapport d&apos;analyse
      </PieceButton>
    </div>
  );
}

function PieceButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-[10px] border border-dash-border bg-white px-3.5 py-2.5 font-body text-[13px] font-medium text-dash-text transition hover:border-dash-blue"
    >
      {children}
    </button>
  );
}

/** En-tête de section (mono, majuscules, discret) — identité ORQA. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 font-data text-[11px] uppercase tracking-[0.1em] text-dash-text-tertiary">
      {children}
    </p>
  );
}

const DECISION_DOT: Record<LlmDecision, string> = {
  satisfait: 'bg-dash-green',
  partiel: 'bg-dash-orange',
  non: 'bg-dash-red',
  non_verifiable: 'bg-dash-text-tertiary',
};

/** Grille critère par critère (triée par criticité). */
export function CriteriaGrid({ breakdown }: { breakdown: CriterionDecision[] }) {
  const ordered = sortByCriticality(breakdown);
  return (
    <div className="overflow-hidden rounded-[11px] border border-dash-border">
      {ordered.map((b, i) => {
        const m = formatCriterionMethod(b);
        return (
          <div
            key={`${b.criterionId}-${i}`}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-b border-dash-border px-3.5 py-2.5 last:border-b-0"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DECISION_DOT[b.llmDecision]}`} />
            <div className="min-w-0">
              <p className="font-body text-[13px] text-dash-text">{b.criterionLabel}</p>
              <p className="font-body text-[11px] text-dash-text-tertiary">
                {m.label}
                {m.foundKeywords.length > 0 ? ` · ${m.foundKeywords.join(', ')}` : ''}
              </p>
            </div>
            <span className="whitespace-nowrap font-data text-[11.5px] text-dash-text-secondary">
              poids {b.weight}
            </span>
            <span className="whitespace-nowrap font-data text-[13px] font-medium text-dash-text">
              {b.contribution > 0 ? '+' : ''}
              {b.contribution}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Parcours en 4 phases (cartes). */
export function JourneyPhases({ journey }: { journey: CandidateJourney }) {
  const cols = journeyColumns(journey);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cols.map((c) => {
        const reached = c.reached;
        const tone =
          c.tone === 'positive'
            ? 'border-[color-mix(in srgb, var(--dash-green) 35%, transparent)] bg-dash-green-light text-dash-green'
            : c.tone === 'pending'
              ? 'border-[color-mix(in srgb, var(--dash-orange) 35%, transparent)] bg-dash-orange-light text-dash-orange'
              : c.tone === 'negative' || c.tone === 'screening_out'
                ? 'border-[color-mix(in srgb, var(--dash-red) 35%, transparent)] bg-dash-red-light text-dash-red'
                : 'border-dash-border bg-dash-bg text-dash-text';
        return (
          <div
            key={c.key}
            className={`rounded-[11px] border px-3 py-2.5 ${reached ? tone : 'border-dash-border bg-dash-bg'}`}
          >
            <p className="font-body text-[11px] uppercase tracking-wide text-dash-text-tertiary">
              {c.title}
            </p>
            <p
              className={`mt-1 font-body text-[13px] font-medium ${reached ? '' : 'text-dash-text-tertiary'}`}
            >
              {c.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const TIMELINE_RING: Record<TimelineTone, string> = {
  neutral: 'border-dash-blue bg-dash-blue',
  positive: 'border-dash-green bg-dash-green',
  negative: 'border-dash-red bg-dash-red',
  pending: 'border-dash-orange bg-dash-orange',
};

/** Frise datée (pastilles colorées). */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="font-body text-[12px] italic text-dash-text-tertiary">
        Aucun événement daté.
      </p>
    );
  }
  return (
    <div className="relative pl-[22px]">
      <span className="absolute bottom-1 left-[5px] top-1 w-0.5 bg-dash-border" />
      {events.map((e) => (
        <div key={e.key} className="relative pb-3.5 last:pb-0">
          <span
            className={`absolute left-[-22px] top-0.5 h-3 w-3 rounded-full border-2 ${TIMELINE_RING[e.tone]}`}
          />
          <p className="font-body text-[13.5px] font-medium text-dash-text">{e.label}</p>
          {e.detail ? (
            <p className="font-body text-[11.5px] text-dash-text-secondary">{e.detail}</p>
          ) : null}
          <p className="mt-0.5 font-data text-[11.5px] text-dash-text-tertiary">
            {formatFrDateTime(e.at)}
          </p>
        </div>
      ))}
    </div>
  );
}
