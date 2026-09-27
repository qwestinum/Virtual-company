'use client';

/**
 * Pastille d'étape de candidature — POINT D'AFFICHAGE UNIQUE.
 *
 * Trois écrans la rendaient chacun à sa façon (panneau, page pleine, ligne de
 * liste) en concaténant la même classe de couleur. Un seul composant, parce
 * que le repère non chromatique doit suivre la couleur PARTOUT : une pastille
 * qui garderait la couleur sans le repère redeviendrait indiscernable de ses
 * deux voisines de pipeline.
 *
 * Couleurs : `stagePillStyle` (palette conforme AA, cf. stage-ui.ts).
 * Repère    : `stageStepMarks` — segments remplis jusqu'au rang de l'étape.
 */

import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';
import type { CandidateStage } from '@/lib/reporting/candidate-stage';

import { stagePillStyle, stageStepMarks } from './stage-ui';

export type StagePillProps = {
  stage: CandidateStage;
  /** Densité : la ligne de liste est un cran plus serrée que les fiches. */
  compact?: boolean;
};

export function StagePill({ stage, compact = false }: StagePillProps) {
  const { color, background } = stagePillStyle(stage);
  const marks = stageStepMarks(stage);

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-inter text-[12px] font-medium"
      style={{
        color,
        background,
        padding: compact ? '4px 10px' : '6px 12px',
      }}
    >
      {CANDIDATE_STAGE_LABELS[stage]}
      {marks.length > 0 ? (
        // aria-hidden : le libellé juste à gauche dit déjà l'étape. Le repère
        // est une aide au BALAYAGE visuel, il n'ajoute rien à la lecture
        // vocale — l'y répéter ferait du bruit.
        <span aria-hidden className="inline-flex items-center gap-[2px]">
          {marks.map((filled, i) => (
            <span
              key={i}
              style={{
                width: 3,
                height: 3,
                borderRadius: 999,
                background: 'currentColor',
                // Non chromatique : c'est l'OPACITÉ qui porte l'information,
                // jamais une seconde teinte — sinon on remplacerait une
                // dépendance à la couleur par une autre.
                opacity: filled ? 0.9 : 0.25,
              }}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}
