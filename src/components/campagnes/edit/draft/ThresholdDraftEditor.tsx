'use client';

/**
 * Éditeur des DEUX seuils de décision pour un brouillon de campagne (HITL 3
 * zones, lot 2). Présentational : l'état vit dans le sheet de création tant que
 * la campagne n'est pas créée. Un seul slider à deux poignées (ThreeZoneRange)
 * affiche les 3 zones — proposé au refus / à examiner / acceptation auto.
 *
 * ⚠️ Libellés et phrase de récapitulation viennent de `threshold-labels.ts`,
 * PARTAGÉ avec le curseur d'édition. Ce fichier a affiché « Refus auto < N »
 * pendant un mois après le retrait de l'envoi automatique — parce qu'il portait
 * sa propre copie des textes.
 */

import {
  NO_AUTOMATIC_REJECTION,
  thresholdZoneHint,
  thresholdZoneLabels,
} from '@/lib/campaign/threshold-labels';

import { ThreeZoneRange } from '../ThreeZoneRange';

export type ThresholdDraftEditorProps = {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
};

export function ThresholdDraftEditor({
  low,
  high,
  onChange,
}: ThresholdDraftEditorProps) {
  const hint = thresholdZoneHint(low, high);
  const labels = thresholdZoneLabels(low, high);

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        background: 'var(--dash-warm)',
        border: '1px solid var(--dash-border)',
      }}
    >
      <div
        className="font-data"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {/* Orange et non rouge : sous le seuil bas rien ne part, c'est une
            attente. Le rouge annoncerait un refus consommé. */}
        <span style={{ color: 'var(--dash-orange)' }}>{labels.low}</span>
        <span style={{ color: 'var(--dash-orange)' }}>{labels.middle}</span>
        <span style={{ color: 'var(--dash-green)' }}>{labels.high}</span>
      </div>

      <ThreeZoneRange low={low} high={high} onChange={onChange} />

      <p
        className="font-body"
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          lineHeight: 1.4,
        }}
      >
        {hint} <strong>{NO_AUTOMATIC_REJECTION}</strong> : sous le seuil bas,
        la candidature part dans «&nbsp;Propositions de refus&nbsp;», où vous la
        refusez en un geste. Seule l&apos;acceptation au-dessus du seuil haut
        déclenche un mail sans vous.
      </p>
    </div>
  );
}
