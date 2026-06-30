'use client';

/**
 * Détail complet (NIVEAU 3), identité ORQA — UNE seule colonne. RÉUTILISE
 * toutes les données/dérivations (route `[id]`, `journeyColumns`,
 * `sortByCriticality`, timeline) ; présentation native ORQA (l'onglet Audit
 * garde `CandidateAuditDetail`).
 *
 * Sortie ROBUSTE : ✕, clic sur le fond, touche Échap. Une action ne ferme pas
 * la page (re-fetch + étape à jour).
 */

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatFrDate } from '@/lib/reporting/audit-display';
import {
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';
import type { TimelineEvent } from '@/lib/reporting/candidate-timeline';
import type { CandidateAnalysisDetail, CandidateListItem } from '@/types/reporting';

import { CandidatureActions } from './CandidatureActions';
import {
  CriteriaGrid,
  DetailPieces,
  JourneyPhases,
  SectionLabel,
  TimelineList,
} from './CandidatureDetailBlocks';
import { ScoreRing } from './ScoreRing';
import { STAGE_PILL_CLASS, initials } from './stage-ui';
import { ZonePill } from './ZonePill';

type DetailResponse = {
  candidate: CandidateAnalysisDetail;
  vivierOrigin: { contactedAt: string | null } | null;
  cvArtifactId: string | null;
  timeline: TimelineEvent[];
  stage: CandidateStage;
};

export function CandidatureFullPage({
  item,
  onClose,
  onActed,
}: {
  item: CandidateListItem;
  onClose: () => void;
  onActed: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  // Sortie au clavier (Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Refetch au retour sur l'onglet/fenêtre (événement externe → « RDV pris »).
  useEffect(() => {
    const bump = () => setLocalRefresh((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', bump);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', bump);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(false);
      try {
        const res = await fetch(
          `/api/reporting/audit/candidates/${encodeURIComponent(item.id)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        if (!cancelled) setData((await res.json()) as DetailResponse);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, localRefresh]);

  const liveItem = useMemo(
    () => ({ ...item, stage: data?.stage ?? item.stage }),
    [item, data?.stage],
  );
  const handleActed = () => {
    setLocalRefresh((n) => n + 1);
    onActed();
  };

  const overlay = (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-orqa-nuit/30"
      onClick={onClose}
    >
      {/* Flex-colonne : barre fixe (shrink-0) AU-DESSUS d'une zone scrollable —
          la barre ne se superpose jamais au contenu (≠ sticky). */}
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-orqa-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-orqa-ligne px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 font-inter text-[13px] font-medium text-orqa-gris hover:text-orqa-ciel"
          >
            ← Retour aux candidatures
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le détail"
            title="Fermer (Échap)"
            className="grid h-9 w-9 place-items-center rounded-full border border-orqa-ligne text-orqa-gris transition hover:border-orqa-rouge hover:bg-orqa-rouge-bg hover:text-orqa-rouge"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {error ? (
            <Centered>Impossible de charger ce candidat.</Centered>
          ) : !data ? (
            <Centered>Chargement…</Centered>
          ) : (
            <Body data={data} item={liveItem} onActed={handleActed} />
          )}
        </div>
      </div>
    </div>
  );

  // Portail vers <body> : l'overlay SORT du WorkspacePane (et de sa barre
  // d'onglets) → couvre tout le viewport, le ✕ est en haut à droite de l'écran.
  return typeof document === 'undefined'
    ? null
    : createPortal(overlay, document.body);
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid place-items-center py-24 font-inter text-[14px] text-orqa-gris">
      {children}
    </div>
  );
}

function Body({
  data,
  item,
  onActed,
}: {
  data: DetailResponse;
  item: CandidateListItem;
  onActed: () => void;
}) {
  const { candidate, vivierOrigin, cvArtifactId, timeline, stage } = data;
  const { application } = candidate;
  const { scoringResult, narration } = application;
  const profile = application.candidate;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-7 py-6">
      {/* Identité + score */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-orqa-nuit to-orqa-nuit2 font-inter text-[17px] font-semibold text-white">
            {initials(candidate.candidateName)}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-fraunces text-[22px] font-semibold tracking-tight text-orqa-nuit">
                {candidate.candidateName}
              </h2>
              {candidate.fromVivier ? (
                <span className="rounded-md border border-[#d6ccf5] bg-orqa-violet-bg px-1.5 py-0.5 font-data text-[10px] uppercase tracking-wide text-orqa-violet">
                  ★ Vivier
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 font-inter text-[13px] text-orqa-gris">
              {candidate.campaignId ? (
                <span className="font-data text-orqa-ciel">{candidate.campaignId}</span>
              ) : (
                'Hors campagne'
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ScoreRing score={scoringResult.totalScore} size="lg" />
          <div className="flex flex-col items-start gap-1.5">
            <ZonePill zone={candidate.decisionZone} status={candidate.status} />
            <span
              className={`rounded-full px-3 py-1 font-inter text-[12px] font-medium ${STAGE_PILL_CLASS[stage]}`}
            >
              {CANDIDATE_STAGE_LABELS[stage]}
            </span>
          </div>
        </div>
      </div>

      <Section label="Pièces">
        <DetailPieces analysisId={candidate.id} cvArtifactId={cvArtifactId} />
      </Section>

      <Section label="Action">
        <CandidatureActions item={item} onActed={onActed} />
      </Section>

      <Section label="Profil">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
          <Field label="Email" value={profile.email ?? '— manquant'} />
          <Field label="Téléphone" value={profile.phone ?? '—'} />
          <Field label="Localisation" value={profile.location ?? '—'} />
          <Field label="Canal" value={profile.source} />
          <Field label="Reçu le" value={formatFrDate(profile.receivedAt)} />
          {candidate.fromVivier ? (
            <Field
              label="Origine"
              value={
                vivierOrigin?.contactedAt
                  ? `Vivier · contacté le ${formatFrDate(vivierOrigin.contactedAt)}`
                  : 'Vivier'
              }
            />
          ) : null}
        </dl>
      </Section>

      <Section label="Évaluation par critère">
        <CriteriaGrid breakdown={scoringResult.breakdown} />
      </Section>

      {narration.strengths.length > 0 || narration.weaknesses.length > 0 ? (
        <Section label="Points forts / points d'attention">
          <ul className="flex flex-col gap-1.5 font-inter text-[13px] leading-relaxed">
            {narration.strengths.map((s, i) => (
              <li key={`s${i}`} className="text-orqa-encre">
                + {s}
              </li>
            ))}
            {narration.weaknesses.map((w, i) => (
              <li key={`w${i}`} className="text-orqa-ambre">
                ! {w}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section label="Parcours">
        {candidate.journey ? (
          <JourneyPhases journey={candidate.journey} />
        ) : (
          <p className="font-inter text-[12px] italic text-orqa-gris-clair">
            Parcours indisponible.
          </p>
        )}
      </Section>

      <Section label="Historique">
        <TimelineList events={timeline} />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-inter text-[11px] text-orqa-gris-clair">{label}</dt>
      <dd className="font-inter text-[13px] text-orqa-encre">{value}</dd>
    </div>
  );
}
