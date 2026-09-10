'use client';

/**
 * Le bloc « L'annonce » du formulaire APEC : ce que la campagne sait déjà.
 *
 * La séparation d'avec « Ce que l'Apec demande en plus » (`ApecRequirementsGrid`)
 * est le message : ici on relit, là-bas on tranche. Mélanger les deux ferait
 * relire cent fois ce qui est acquis et survoler ce qui ne l'est pas — et c'est
 * ce qui permet au panneau de n'ouvrir qu'une section à la fois.
 *
 * Chaque champ déduit porte sa provenance (cf. `ApecFieldRow`) : une valeur
 * traduite se présente comme une proposition, jamais comme un fait.
 *
 * Le « profil recherché » est le seul champ RÉDIGÉ par le modèle, dès
 * l'ouverture : il porte donc son propre état (rédaction en cours, échec) et
 * son propre geste (« Rédiger à nouveau »), au plus près du texte concerné —
 * une erreur globale en tête de panneau ne dirait pas quel champ elle vise.
 */
import { APEC_PROFILE_TARGET_CHARS } from '@/lib/agents/apec-profile-prompts';
import type { AdepDraftOffer, AdepFieldNote } from '@/lib/jobboards/adep/mapping';
import { withGenderMention } from '@/lib/jobboards/adep/build-open-position';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';
import type { AdepOffer } from '@/types/adep';

import { ApecFieldRow } from './ApecFieldRow';
import { ghostBtn, inputStyle, labelStyle } from './job-ad-panel-styles';

type Notes = Partial<Record<keyof AdepOffer, AdepFieldNote>>;

export type ApecOfferFormProps = {
  offer: AdepDraftOffer;
  notes: Notes;
  onChange: (patch: Partial<AdepDraftOffer>) => void;
  /** Le modèle rédige le profil en ce moment. */
  profileDrafting: boolean;
  /** La rédaction du profil n'a pas abouti — dit sous le champ. */
  profileError: string | null;
  onDraftProfile: () => void;
};

const areaStyle = { ...inputStyle, minHeight: 92, resize: 'vertical' as const };

/** « 38/80 » — le compteur porte sur le texte RÉELLEMENT envoyé. */
function counter(value: string, max: number, min?: number): string {
  const n = value.trim().length;
  return min && n < min ? `${n}/${min} minimum` : `${n}/${max}`;
}

export function ApecOfferForm({
  offer,
  notes,
  onChange,
  profileDrafting,
  profileError,
  onDraftProfile,
}: ApecOfferFormProps) {
  // L'intitulé part avec « H/F » : le compteur doit dire la vérité sur ce qui
  // sera envoyé, pas sur ce qui est saisi.
  const sentTitle = offer.positionTitle ? withGenderMention(offer.positionTitle) : '';

  return (
    <div>
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
        // La provenance passe par la note ordinaire, jamais par un faux
        // « déduit de rédaction en cours » : l'état de rédaction se lit sur le
        // bouton, sous le champ.
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onDraftProfile}
            disabled={profileDrafting}
            style={{
              ...ghostBtn,
              padding: '4px 9px',
              fontSize: 11.5,
              opacity: profileDrafting ? 0.6 : 1,
            }}
          >
            {profileDrafting ? 'Rédaction en cours…' : 'Rédiger à nouveau'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--dash-text-secondary)' }}>
            à partir du descriptif ci-dessus, en ~{APEC_PROFILE_TARGET_CHARS}{' '}
            caractères
          </span>
        </div>
        {profileError ? (
          <div style={{ fontSize: 11, marginTop: 4, color: 'var(--dash-yellow)' }}>
            {profileError} — le champ garde les compétences clés de la fiche, à
            reformuler à la main si besoin.
          </div>
        ) : null}
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

      <label style={labelStyle}>Candidatures reçues sur</label>
      <div style={{ ...inputStyle, background: 'var(--dash-warm)' }}>
        {offer.applicationEmail || '— aucune boîte associée —'}
      </div>
    </div>
  );
}
