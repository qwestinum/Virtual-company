'use client';

/**
 * Le formulaire de publication APEC — les champs qu'ORQA ne possède pas.
 *
 * Rangés en deux blocs, et la séparation est le message : « L'annonce » reprend
 * ce que la campagne sait déjà ; « Ce que l'Apec demande en plus » est ce que le
 * recruteur doit trancher. Mélanger les deux ferait relire cent fois ce qui est
 * acquis et survoler ce qui ne l'est pas.
 *
 * Chaque champ déduit porte sa provenance (cf. `ApecFieldRow`) : une valeur
 * traduite se présente comme une proposition, jamais comme un fait.
 */
import type { AdepDraftOffer, AdepFieldNote } from '@/lib/jobboards/adep/mapping';
import { withGenderMention } from '@/lib/jobboards/adep/build-open-position';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';
import type { AdepOffer } from '@/types/adep';

import { ApecFieldRow } from './ApecFieldRow';
import { ApecRequirementsGrid } from './ApecRequirementsGrid';
import { inputStyle, labelStyle } from './job-ad-panel-styles';

type Notes = Partial<Record<keyof AdepOffer, AdepFieldNote>>;

export type ApecOfferFormProps = {
  offer: AdepDraftOffer;
  notes: Notes;
  onChange: (patch: Partial<AdepDraftOffer>) => void;
};

const areaStyle = { ...inputStyle, minHeight: 92, resize: 'vertical' as const };
const sectionStyle = {
  margin: '14px 0 4px',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--dash-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
};

/** « 38/80 » — le compteur porte sur le texte RÉELLEMENT envoyé. */
function counter(value: string, max: number, min?: number): string {
  const n = value.trim().length;
  return min && n < min ? `${n}/${min} minimum` : `${n}/${max}`;
}

export function ApecOfferForm({ offer, notes, onChange }: ApecOfferFormProps) {
  // L'intitulé part avec « H/F » : le compteur doit dire la vérité sur ce qui
  // sera envoyé, pas sur ce qui est saisi.
  const sentTitle = offer.positionTitle ? withGenderMention(offer.positionTitle) : '';

  return (
    <div>
      <div style={sectionStyle}>L’annonce</div>

      <ApecFieldRow
        label="Intitulé du poste"
        note={notes.positionTitle}
        counter={counter(sentTitle, ADEP_LIMITS.positionTitleWithMention)}
      >
        <input
          style={inputStyle}
          value={offer.positionTitle}
          onChange={(e) => onChange({ positionTitle: e.target.value })}
        />
        {sentTitle && sentTitle !== offer.positionTitle.trim() ? (
          <div style={{ fontSize: 11, marginTop: 3, color: 'var(--dash-text-secondary)' }}>
            Envoyé sous « {sentTitle} » — l’Apec exige la mention H/F.
          </div>
        ) : null}
      </ApecFieldRow>

      <ApecFieldRow
        label="Descriptif du poste"
        note={notes.positionDescription}
        counter={counter(
          offer.positionDescription,
          ADEP_LIMITS.positionDescriptionMax,
          ADEP_LIMITS.positionDescriptionMin,
        )}
      >
        <textarea
          style={areaStyle}
          value={offer.positionDescription}
          onChange={(e) => onChange({ positionDescription: e.target.value })}
        />
      </ApecFieldRow>

      <ApecFieldRow
        label="Description du profil"
        note={notes.profileDescription}
        counter={counter(
          offer.profileDescription,
          ADEP_LIMITS.profileDescriptionMax,
          ADEP_LIMITS.profileDescriptionMin,
        )}
      >
        <textarea
          style={areaStyle}
          value={offer.profileDescription}
          onChange={(e) => onChange({ profileDescription: e.target.value })}
        />
      </ApecFieldRow>

      <ApecFieldRow
        label="Description de l’entreprise"
        note={notes.organizationDescription}
        counter={counter(
          offer.organizationDescription,
          ADEP_LIMITS.organizationDescriptionMax,
          ADEP_LIMITS.organizationDescriptionMin,
        )}
      >
        <textarea
          style={areaStyle}
          value={offer.organizationDescription}
          onChange={(e) => onChange({ organizationDescription: e.target.value })}
        />
      </ApecFieldRow>

      <ApecRequirementsGrid offer={offer} notes={notes} onChange={onChange} />

      <label style={labelStyle}>Candidatures reçues sur</label>
      <div style={{ ...inputStyle, background: 'var(--dash-warm)' }}>
        {offer.applicationEmail || '— aucune boîte associée —'}
      </div>
    </div>
  );
}
