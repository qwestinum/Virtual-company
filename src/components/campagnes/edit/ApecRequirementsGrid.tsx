'use client';

/**
 * Les champs qu'ORQA ne possède pas — le cœur du formulaire APEC.
 *
 * Séparé de l'annonce parce que la séparation EST le message : au-dessus, ce
 * que la campagne sait déjà et qu'on relit ; ici, ce que le recruteur doit
 * trancher. Mélanger les deux ferait relire cent fois l'acquis et survoler le
 * reste.
 */
import type { AdepDraftOffer, AdepFieldNote } from '@/lib/jobboards/adep/mapping';
import {
  NIVEAU_EXPERIENCE_CODES,
  NIVEAU_EXPERIENCE_LABELS,
  STATUT_POSTE_CODES,
  STATUT_POSTE_LABELS,
  TYPE_CONTRAT_CODES,
  TYPE_CONTRAT_LABELS,
  ZONE_DEPLACEMENT_CODES,
  ZONE_DEPLACEMENT_LABELS,
} from '@/lib/jobboards/adep/domains';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';
import type { AdepOffer } from '@/types/adep';

import { ApecCompensationFields } from './ApecCompensationFields';
import { ApecFieldRow, ApecSelect, domainOptions } from './ApecFieldRow';
import { inputStyle } from './job-ad-panel-styles';

export type ApecRequirementsGridProps = {
  offer: AdepDraftOffer;
  notes: Partial<Record<keyof AdepOffer, AdepFieldNote>>;
  onChange: (patch: Partial<AdepDraftOffer>) => void;
};


const sectionStyle = {
  margin: '14px 0 4px',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--dash-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
};
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 10,
};

/** Contrats à durée INDÉTERMINÉE — la durée y est interdite (API_397). */
const OPEN_ENDED = ['1', '2', '3', '4'];

export function ApecRequirementsGrid({
  offer,
  notes,
  onChange,
}: ApecRequirementsGridProps) {
  const needsDuration = offer.jobType != null && !OPEN_ENDED.includes(offer.jobType);

  return (
    <>
      <div style={sectionStyle}>Ce que l’Apec demande en plus</div>

      <div style={gridStyle}>
        <ApecFieldRow label="Type de contrat" field="jobType" note={notes.jobType}>
          <ApecSelect
            value={offer.jobType}
            onChange={(jobType) =>
              onChange({
                jobType,
                // Un CDI ne peut pas porter de durée (API_397) : on la retire
                // au lieu de laisser le validateur refuser une saisie qui
                // n'est plus visible.
                ...(jobType && ['1', '2', '3', '4'].includes(jobType)
                  ? { durationMonths: null }
                  : {}),
              })
            }
            options={domainOptions(TYPE_CONTRAT_CODES, TYPE_CONTRAT_LABELS)}
            emptyLabel="— à choisir —"
          />
        </ApecFieldRow>

        {needsDuration ? (
          <ApecFieldRow label="Durée (mois)" field="durationMonths" note={notes.durationMonths}>
            <input
              style={inputStyle}
              type="number"
              min={ADEP_LIMITS.durationMin}
              max={ADEP_LIMITS.durationMax}
              value={offer.durationMonths ?? ''}
              onChange={(e) =>
                onChange({ durationMonths: e.target.value ? Number(e.target.value) : null })
              }
            />
          </ApecFieldRow>
        ) : null}

        <ApecFieldRow label="Statut du poste" field="statusJob" note={notes.statusJob}>
          <ApecSelect
            value={offer.statusJob}
            onChange={(statusJob) => onChange({ statusJob })}
            options={domainOptions(STATUT_POSTE_CODES, STATUT_POSTE_LABELS)}
            emptyLabel="— à choisir —"
          />
        </ApecFieldRow>

        <ApecFieldRow label="Expérience attendue" field="experienceLevel" note={notes.experienceLevel}>
          <ApecSelect
            value={offer.experienceLevel}
            onChange={(experienceLevel) => onChange({ experienceLevel })}
            options={domainOptions(NIVEAU_EXPERIENCE_CODES, NIVEAU_EXPERIENCE_LABELS)}
            emptyLabel="— à choisir —"
          />
        </ApecFieldRow>

        <ApecFieldRow
          label="Commune (code INSEE)"
          field="inseeCode"
          note={notes.inseeCode}
          hint={
            <>
              Code officiel de la commune (5 caractères), attribué par l’INSEE.
              Ce n’est <strong>pas le code postal</strong> : Tours a pour code
              INSEE 37261 et pour code postal 37000. Un code postal peut couvrir
              plusieurs communes, un code INSEE en désigne une seule — c’est
              pourquoi l’Apec l’exige. À trouver sur insee.fr (« code officiel
              géographique »).
            </>
          }
        >
          <input
            style={inputStyle}
            value={offer.inseeCode ?? ''}
            placeholder="37261"
            onChange={(e) => onChange({ inseeCode: e.target.value || null })}
          />
        </ApecFieldRow>

        <ApecFieldRow label="Zone de déplacement" field="travelZone" note={notes.travelZone}>
          <ApecSelect
            value={offer.travelZone}
            onChange={(travelZone) => travelZone && onChange({ travelZone })}
            options={domainOptions(ZONE_DEPLACEMENT_CODES, ZONE_DEPLACEMENT_LABELS)}
          />
        </ApecFieldRow>

        <ApecCompensationFields offer={offer} notes={notes} onChange={onChange} />
      </div>
    </>
  );
}
