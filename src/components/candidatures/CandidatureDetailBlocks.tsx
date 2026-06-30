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
      className="inline-flex items-center gap-2 rounded-[10px] border border-orqa-ligne bg-white px-3.5 py-2.5 font-inter text-[13px] font-medium text-orqa-nuit transition hover:border-orqa-ciel hover:shadow-orqa"
    >
      {children}
    </button>
  );
}

/** En-tête de section (mono, majuscules, discret) — identité ORQA. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 font-data text-[11px] uppercase tracking-[0.1em] text-orqa-gris-clair">
      {children}
    </p>
  );
}

const DECISION_DOT: Record<LlmDecision, string> = {
  satisfait: 'bg-orqa-vert',
  partiel: 'bg-orqa-ambre',
  non: 'bg-orqa-rouge',
  non_verifiable: 'bg-orqa-gris-clair',
};

/** Grille critère par critère (triée par criticité). */
export function CriteriaGrid({ breakdown }: { breakdown: CriterionDecision[] }) {
  const ordered = sortByCriticality(breakdown);
  return (
    <div className="overflow-hidden rounded-[11px] border border-orqa-ligne">
      {ordered.map((b, i) => {
        const m = formatCriterionMethod(b);
        return (
          <div
            key={`${b.criterionId}-${i}`}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-b border-orqa-ligne px-3.5 py-2.5 last:border-b-0"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DECISION_DOT[b.llmDecision]}`} />
            <div className="min-w-0">
              <p className="font-inter text-[13px] text-orqa-encre">{b.criterionLabel}</p>
              <p className="font-inter text-[11px] text-orqa-gris-clair">
                {m.label}
                {m.foundKeywords.length > 0 ? ` · ${m.foundKeywords.join(', ')}` : ''}
              </p>
            </div>
            <span className="whitespace-nowrap font-data text-[11.5px] text-orqa-gris">
              poids {b.weight}
            </span>
            <span className="whitespace-nowrap font-data text-[13px] font-medium text-orqa-nuit">
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
            ? 'border-[#bfe6ce] bg-orqa-vert-bg text-orqa-vert'
            : c.tone === 'pending'
              ? 'border-[#f0dcb0] bg-orqa-ambre-bg text-orqa-ambre'
              : c.tone === 'negative' || c.tone === 'screening_out'
                ? 'border-[#f3c9cb] bg-orqa-rouge-bg text-orqa-rouge'
                : 'border-orqa-ligne bg-orqa-brume text-orqa-encre';
        return (
          <div
            key={c.key}
            className={`rounded-[11px] border px-3 py-2.5 ${reached ? tone : 'border-orqa-ligne bg-orqa-brume'}`}
          >
            <p className="font-inter text-[11px] uppercase tracking-wide text-orqa-gris-clair">
              {c.title}
            </p>
            <p
              className={`mt-1 font-inter text-[13px] font-medium ${reached ? '' : 'text-orqa-gris-clair'}`}
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
  neutral: 'border-orqa-ciel bg-orqa-ciel',
  positive: 'border-orqa-vert bg-orqa-vert',
  negative: 'border-orqa-rouge bg-orqa-rouge',
  pending: 'border-orqa-ambre bg-orqa-ambre',
};

/** Frise datée (pastilles colorées). */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="font-inter text-[12px] italic text-orqa-gris-clair">
        Aucun événement daté.
      </p>
    );
  }
  return (
    <div className="relative pl-[22px]">
      <span className="absolute bottom-1 left-[5px] top-1 w-0.5 bg-orqa-brume2" />
      {events.map((e) => (
        <div key={e.key} className="relative pb-3.5 last:pb-0">
          <span
            className={`absolute left-[-22px] top-0.5 h-3 w-3 rounded-full border-2 ${TIMELINE_RING[e.tone]}`}
          />
          <p className="font-inter text-[13.5px] font-medium text-orqa-encre">{e.label}</p>
          {e.detail ? (
            <p className="font-inter text-[11.5px] text-orqa-gris">{e.detail}</p>
          ) : null}
          <p className="mt-0.5 font-data text-[11.5px] text-orqa-gris-clair">
            {formatFrDateTime(e.at)}
          </p>
        </div>
      ))}
    </div>
  );
}
