'use client';

/**
 * Le récapitulatif — cinq lignes, et chacune se corrige SUR PLACE.
 *
 * « Modifier » renvoie à SON étape, pas à un septième écran d'édition : une
 * correction qui change d'endroit fait douter de ce qu'on vient de relire.
 */

import type { AssistantStep } from '@/lib/campagnes/assistant-steps';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';

export type RecapLine = { step: AssistantStep; titre: string; valeur: string };

/** Valeur d'un champ de FDP, rendue lisible. Jamais « undefined » à l'écran. */
function champ(fdp: FDPInProgress, key: FieldKey): string {
  const v = fdp.fields[key]?.value;
  if (v == null || v === '') return '';
  return Array.isArray(v) ? v.join(' · ') : String(v);
}

export function buildRecapLines(input: {
  fdp: FDPInProgress;
  criteriaCount: number;
  criticalCount: number;
  sourceLabels: string[];
  ownerLabel: string;
  thresholdLow: number;
  thresholdHigh: number;
  schedulingLabel: string;
}): RecapLine[] {
  const poste = [
    champ(input.fdp, 'job_title'),
    champ(input.fdp, 'contract_type'),
    champ(input.fdp, 'location'),
    champ(input.fdp, 'salary_range'),
  ].filter(Boolean);

  const reception = [...input.sourceLabels];

  return [
    { step: 'poste', titre: 'Le poste', valeur: poste.join(' · ') || 'À compléter' },
    {
      step: 'criteres',
      titre: 'Ce qui compte',
      valeur:
        `${input.criteriaCount} point${input.criteriaCount > 1 ? 's' : ''} de notation` +
        (input.criticalCount > 0
          ? `, dont ${input.criticalCount} critique${input.criticalCount > 1 ? 's' : ''}`
          : ''),
    },
    {
      step: 'reception',
      titre: 'La réception',
      valeur: reception.length > 0 ? reception.join(' · ') : 'Aucune source choisie',
    },
    {
      step: 'suivi',
      titre: 'Le suivi',
      valeur: `${input.ownerLabel} · propose d’écarter sous ${input.thresholdLow} · invite à partir de ${input.thresholdHigh}`,
    },
    { step: 'reservation', titre: 'La réservation', valeur: input.schedulingLabel },
  ];
}

export function AssistantRecap({
  lines,
  onGo,
}: {
  lines: RecapLine[];
  onGo: (step: AssistantStep) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((l, i) => (
        <div
          key={l.step}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 14,
            padding: '11px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--dash-border)',
          }}
        >
          <span
            className="font-display"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--dash-text-secondary)',
              width: 130,
              flexShrink: 0,
            }}
          >
            {l.titre}
          </span>
          <span className="font-body" style={{ fontSize: 13, color: 'var(--dash-text)', flex: 1 }}>
            {l.valeur}
          </span>
          <button
            type="button"
            data-modifier={l.step}
            onClick={() => onGo(l.step)}
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--dash-blue)',
              background: 'none',
              border: 'none',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            Modifier
          </button>
        </div>
      ))}
    </div>
  );
}
