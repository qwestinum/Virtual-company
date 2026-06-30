'use client';

/**
 * Ruban-pipeline (ossature). Chaque carte = une étape + son volume EXHAUSTIF
 * (périmètre campagne+période) ; cliquer filtre la liste par étape. Compteurs
 * de `/api/candidatures/counters` (jamais du journal tronqué), figés à la
 * recherche texte.
 */

import {
  CANDIDATE_STAGE_LABELS,
  CANDIDATE_STAGE_RIBBON_ORDER,
  type CandidateStage,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';

import { STAGE_DOT_CLASS } from './stage-ui';

export function CandidaturesRibbon({
  counts,
  active,
  onSelect,
}: {
  counts: CandidateStageCounts;
  active: CandidateStage | null;
  onSelect: (stage: CandidateStage | null) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {CANDIDATE_STAGE_RIBBON_ORDER.map((stage) => {
        const selected = active === stage;
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : stage)}
            className={`relative min-w-[120px] flex-1 rounded-[14px] border bg-white px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-orqa-ciel hover:shadow-orqa-lg ${
              selected ? 'border-orqa-nuit shadow-orqa-lg' : 'border-orqa-ligne'
            }`}
          >
            <span className="block font-fraunces text-[26px] font-semibold leading-none text-orqa-nuit">
              {counts[stage]}
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 font-inter text-[11.5px] text-orqa-gris">
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${STAGE_DOT_CLASS[stage]}`}
              />
              {CANDIDATE_STAGE_LABELS[stage]}
            </span>
            <span
              className={`absolute inset-x-0 bottom-0 h-[3px] rounded-b-[14px] opacity-85 ${STAGE_DOT_CLASS[stage]}`}
            />
          </button>
        );
      })}
    </div>
  );
}
