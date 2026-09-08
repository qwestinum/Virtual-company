'use client';

/**
 * Rémunération et conditions de travail — seconde moitié du bloc « ce que
 * l'Apec demande en plus ».
 *
 * Découpé du bloc contrat par thème plutôt qu'au milieu d'une liste : les
 * quatre champs de salaire vont ensemble (l'Apec exige les deux bornes ET le
 * mode d'affichage), et le temps partiel commande sa propre modalité.
 */
import type { AdepDraftOffer, AdepFieldNote } from '@/lib/jobboards/adep/mapping';
import {
  POSITION_TYPES,
  POSITION_TYPE_LABELS,
  SALAIRE_TEXTE_CODES,
  SALAIRE_TEXTE_LABELS,
  TELETRAVAIL_CODES,
  TELETRAVAIL_LABELS,
  TEMPS_PARTIEL_DUREE_CODES,
  TEMPS_PARTIEL_DUREE_LABELS,
} from '@/lib/jobboards/adep/domains';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';
import type { AdepOffer } from '@/types/adep';

import { ApecFieldRow, ApecSelect, domainOptions } from './ApecFieldRow';
import { inputStyle } from './job-ad-panel-styles';

export type ApecCompensationFieldsProps = {
  offer: AdepDraftOffer;
  notes: Partial<Record<keyof AdepOffer, AdepFieldNote>>;
  onChange: (patch: Partial<AdepDraftOffer>) => void;
};

export function ApecCompensationFields({
  offer,
  notes,
  onChange,
}: ApecCompensationFieldsProps) {
  return (
    <>
        <ApecFieldRow label="Salaire minimum (€/an)" note={notes.salaryMin}>
          <input
            style={inputStyle}
            type="number"
            value={offer.salaryMin ?? ''}
            onChange={(e) =>
              onChange({ salaryMin: e.target.value ? Number(e.target.value) : null })
            }
          />
        </ApecFieldRow>

        <ApecFieldRow label="Salaire maximum (€/an)" note={notes.salaryMax}>
          <input
            style={inputStyle}
            type="number"
            value={offer.salaryMax ?? ''}
            onChange={(e) =>
              onChange({ salaryMax: e.target.value ? Number(e.target.value) : null })
            }
          />
        </ApecFieldRow>

        <ApecFieldRow label="Affichage du salaire" note={notes.displayedPay}>
          <ApecSelect
            value={offer.displayedPay}
            onChange={(displayedPay) => displayedPay && onChange({ displayedPay })}
            options={domainOptions(SALAIRE_TEXTE_CODES, SALAIRE_TEXTE_LABELS)}
          />
        </ApecFieldRow>

        <ApecFieldRow label="Temps partiel">
          <ApecSelect
            value={offer.partTime ? 'oui' : 'non'}
            onChange={(v) =>
              onChange({
                partTime: v === 'oui',
                ...(v === 'oui' ? {} : { partTimeDuration: null }),
              })
            }
            options={[
              ['non', 'Non'],
              ['oui', 'Oui'],
            ] as const}
          />
        </ApecFieldRow>

        {offer.partTime ? (
          <ApecFieldRow label="Modalité du temps partiel" note={notes.partTimeDuration}>
            <ApecSelect
              value={offer.partTimeDuration}
              onChange={(partTimeDuration) => onChange({ partTimeDuration })}
              options={domainOptions(TEMPS_PARTIEL_DUREE_CODES, TEMPS_PARTIEL_DUREE_LABELS)}
              emptyLabel="— à choisir —"
            />
          </ApecFieldRow>
        ) : null}

        <ApecFieldRow label="Télétravail">
          <ApecSelect
            value={offer.remoteWork}
            onChange={(remoteWork) => onChange({ remoteWork })}
            options={domainOptions(TELETRAVAIL_CODES, TELETRAVAIL_LABELS)}
            emptyLabel="— non précisé —"
          />
        </ApecFieldRow>

        <ApecFieldRow label="Nombre de postes" note={notes.numberToFill}>
          <input
            style={inputStyle}
            type="number"
            min={ADEP_LIMITS.numberToFillMin}
            max={ADEP_LIMITS.numberToFillMax}
            value={offer.numberToFill}
            onChange={(e) => onChange({ numberToFill: Number(e.target.value) })}
          />
        </ApecFieldRow>

        <ApecFieldRow label="Type d’offre" note={notes.positionType}>
          <ApecSelect
            value={offer.positionType}
            onChange={(positionType) => positionType && onChange({ positionType })}
            options={domainOptions(POSITION_TYPES, POSITION_TYPE_LABELS)}
          />
        </ApecFieldRow>
    </>
  );
}
