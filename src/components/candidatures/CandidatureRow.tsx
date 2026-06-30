'use client';

import {
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';
import type { CandidateListItem } from '@/types/reporting';

import {
  STAGE_DOT_CLASS,
  STAGE_PILL_CLASS,
  STAGE_STEP,
  formatSmartDate,
  initials,
} from './stage-ui';

export function CandidatureRow({
  item,
  campaignLabel,
  selected,
  onClick,
}: {
  item: CandidateListItem;
  /** « CAMP-098 · Program Manager » (résolu côté conteneur) ou null. */
  campaignLabel: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-[14px] border bg-white px-4 py-3.5 text-left transition hover:border-orqa-ciel hover:shadow-orqa ${
        selected ? 'border-orqa-nuit shadow-orqa' : 'border-orqa-ligne'
      }`}
    >
      <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-gradient-to-br from-orqa-nuit to-orqa-nuit2 font-inter text-[13px] font-semibold tracking-wide text-white">
        {initials(item.candidateName)}
      </span>

      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-inter text-[14.5px] font-semibold text-orqa-encre">
            {item.candidateName}
          </span>
          {item.fromVivier ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d6ccf5] bg-orqa-violet-bg px-1.5 py-0.5 font-data text-[10px] uppercase tracking-wide text-orqa-violet">
              ★ Vivier
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate font-inter text-[12px] text-orqa-gris">
          {campaignLabel ?? (item.campaignId ?? 'Sans campagne')} ·{' '}
          {formatSmartDate(item.receivedAt)}
        </span>
      </span>

      <StageProgress stage={item.stage} />

      <span className="flex items-center gap-3.5">
        <span className="font-data text-[15px] font-medium text-orqa-encre">
          {item.totalScore}
          <span className="text-[10px] text-orqa-gris-clair">%</span>
        </span>
        <span
          className={`whitespace-nowrap rounded-full px-3 py-1.5 font-inter text-[12px] font-medium ${STAGE_PILL_CLASS[item.stage]}`}
        >
          {CANDIDATE_STAGE_LABELS[item.stage]}
        </span>
      </span>
    </button>
  );
}

/** Mini-pipeline : segments remplis jusqu'à l'étape courante ; terminal négatif = écarté. */
function StageProgress({ stage }: { stage: CandidateStage }) {
  const step = STAGE_STEP[stage];
  if (step === 0) {
    return (
      <span className="flex items-center gap-2">
        <span className={`h-[5px] w-[22px] rounded-[3px] ${STAGE_DOT_CLASS[stage]}`} />
        <span className="whitespace-nowrap font-inter text-[11px] text-orqa-rouge">
          Écarté
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-[5px] w-[22px] rounded-[3px] ${
            i < step
              ? 'bg-orqa-ciel'
              : i === step
                ? 'bg-orqa-nuit'
                : 'bg-orqa-brume2'
          }`}
        />
      ))}
      <span className="ml-2 whitespace-nowrap font-inter text-[11px] text-orqa-gris">
        {CANDIDATE_STAGE_LABELS[stage]}
      </span>
    </span>
  );
}
