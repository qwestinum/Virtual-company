'use client';

/**
 * Bascule par étape. Chaque puce = une étape + son volume EXHAUSTIF
 * (périmètre campagne+période) ; cliquer filtre la liste par étape. Compteurs
 * de `/api/candidatures/counters` (jamais du journal tronqué), figés à la
 * recherche texte.
 *
 * ⚠️ LES PUCES À POINT COLORÉ, celles de Diffusion et de « Revue de
 * candidature » (essai du 22/09/2026, à la demande du donneur d'ordre), à la
 * place des cartes-compteurs. Une puce ne se désélectionne pas : d'où
 * « Toutes » en tête, qui rend ce que le second clic sur une carte rendait —
 * aucune étape, donc aucun filtre.
 */

import { DotTabs } from '@/components/ui/DotTabs';
import {
  CANDIDATE_STAGE_LABELS,
  CANDIDATE_STAGE_RIBBON_ORDER,
  type CandidateStage,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';

import { STAGE_DOT_CLASS } from './stage-ui';

const TOUTES = 'toutes' as const;
type Puce = CandidateStage | typeof TOUTES;

export function CandidaturesRibbon({
  counts,
  active,
  onSelect,
}: {
  counts: CandidateStageCounts;
  active: CandidateStage | null;
  onSelect: (stage: CandidateStage | null) => void;
}) {
  // Les étapes forment une PARTITION (invariant S6) : leur somme est le total.
  const total = CANDIDATE_STAGE_RIBBON_ORDER.reduce((n, s) => n + counts[s], 0);
  return (
    <DotTabs<Puce>
      ariaLabel="Filtrer les candidatures par étape"
      current={active ?? TOUTES}
      onChange={(k) => onSelect(k === TOUTES ? null : k)}
      tabs={[
        { key: TOUTES, label: 'Toutes', dot: 'var(--dash-text-secondary)', count: total },
        ...CANDIDATE_STAGE_RIBBON_ORDER.map((stage) => ({
          key: stage,
          label: CANDIDATE_STAGE_LABELS[stage],
          dotClass: STAGE_DOT_CLASS[stage],
          count: counts[stage],
        })),
      ]}
    />
  );
}
