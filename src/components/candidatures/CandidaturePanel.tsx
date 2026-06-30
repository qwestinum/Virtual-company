'use client';

/**
 * Panneau latéral (NIVEAU 2), identité ORQA. La liste reste visible à gauche.
 * Essentiel pour agir vite : identité, anneau de score + zone + étape COURANTE,
 * pièces (CV + rapport d'analyse), actions adaptées, lien vers le détail.
 *
 * Une action NE FERME PAS le panneau : on re-fetch le détail (l'étape se met à
 * jour → les actions proposées suivent) et on rafraîchit la liste en arrière-plan.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';
import type { CandidateAnalysisDetail, CandidateListItem } from '@/types/reporting';

import { CandidatureActions } from './CandidatureActions';
import { DetailPieces, SectionLabel } from './CandidatureDetailBlocks';
import { ScoreRing } from './ScoreRing';
import { STAGE_PILL_CLASS, initials } from './stage-ui';
import { ZonePill } from './ZonePill';

type DetailResponse = {
  candidate: CandidateAnalysisDetail;
  cvArtifactId: string | null;
  stage: CandidateStage;
};

export function CandidaturePanel({
  item,
  campaignLabel,
  onClose,
  onOpenFull,
  onActed,
}: {
  item: CandidateListItem;
  campaignLabel: string | null;
  onClose: () => void;
  onOpenFull: () => void;
  onActed: () => void;
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  // Refetch au retour sur l'onglet/fenêtre : un événement externe (réservation
  // Cal.com → « RDV pris ») met à jour l'étape sans recharger.
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
      try {
        const res = await fetch(
          `/api/reporting/audit/candidates/${encodeURIComponent(item.id)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as DetailResponse;
        if (!cancelled) setDetail(json);
      } catch {
        // silencieux
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, localRefresh]);

  const candidate = detail?.candidate.application.candidate;
  // Étape LIVE (re-fetchée après action) ; repli sur le snapshot de liste.
  const liveItem = useMemo(
    () => ({ ...item, stage: detail?.stage ?? item.stage }),
    [item, detail?.stage],
  );

  const handleActed = () => {
    setLocalRefresh((n) => n + 1); // met à jour le panneau (étape + actions)
    onActed(); // rafraîchit la liste + le ruban en arrière-plan
  };

  return (
    <aside className="flex h-full w-full max-w-md flex-col border-l border-orqa-ligne bg-white">
      <header className="flex items-start justify-between gap-3 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-orqa-nuit to-orqa-nuit2 font-inter text-[17px] font-semibold text-white">
            {initials(item.candidateName)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-fraunces text-[21px] font-semibold tracking-tight text-orqa-nuit">
                {item.candidateName}
              </h2>
              {item.fromVivier ? (
                <span className="shrink-0 rounded-md border border-[#d6ccf5] bg-orqa-violet-bg px-1.5 py-0.5 font-data text-[10px] uppercase tracking-wide text-orqa-violet">
                  ★ Vivier
                </span>
              ) : null}
            </div>
            <p className="truncate font-inter text-[13px] text-orqa-gris">
              {campaignLabel ?? (item.campaignId ?? 'Sans campagne')}
            </p>
            <p className="font-data text-[11.5px] text-orqa-ciel">{item.id}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="shrink-0 rounded-md px-2 py-1 font-inter text-[13px] text-orqa-gris-clair hover:bg-orqa-brume"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-6 pb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <ScoreRing score={item.totalScore} size="md" />
          <ZonePill zone={item.decisionZone} status={item.status} />
          <span
            className={`rounded-full px-3 py-1.5 font-inter text-[12px] font-medium ${STAGE_PILL_CLASS[liveItem.stage]}`}
          >
            {CANDIDATE_STAGE_LABELS[liveItem.stage]}
          </span>
        </div>

        <div>
          <SectionLabel>Pièces</SectionLabel>
          <DetailPieces analysisId={item.id} cvArtifactId={detail?.cvArtifactId ?? null} />
        </div>

        <div>
          <SectionLabel>Profil</SectionLabel>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5">
            <Field label="Email" value={candidate?.email ?? item.candidateEmail ?? '— manquant'} />
            <Field label="Téléphone" value={candidate?.phone ?? '—'} />
            <Field label="Localisation" value={candidate?.location ?? '—'} />
            <Field label="Canal" value={candidate?.source ?? item.source} />
          </dl>
        </div>

        <div>
          <SectionLabel>Action</SectionLabel>
          <CandidatureActions item={liveItem} onActed={handleActed} />
        </div>

        <button
          type="button"
          onClick={onOpenFull}
          className="mt-1 rounded-[10px] border border-dashed border-orqa-ciel py-2.5 text-center font-inter text-[13px] font-medium text-orqa-ciel hover:bg-orqa-cielbg"
        >
          Ouvrir le détail complet →
        </button>
      </div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-inter text-[11px] text-orqa-gris-clair">{label}</dt>
      <dd className="truncate font-inter text-[13px] text-orqa-encre">{value}</dd>
    </div>
  );
}
