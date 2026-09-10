'use client';

/**
 * D'où vient le texte de l'offre — et ce qu'il ne fait PAS.
 *
 * Deux messages, et le second est le plus important :
 *
 *   · la PROVENANCE. Un champ pré-rempli sans explication passe pour une saisie
 *     qu'on aurait oubliée ; le recruteur relit alors son propre texte en se
 *     demandant qui l'a écrit ;
 *   · la COPIE. Le texte est repris À CET INSTANT. Modifier l'annonce générique
 *     ensuite ne changera rien à ce qui part chez l'Apec — le dire ici évite
 *     qu'on croie à une synchronisation qui n'existe pas, et qu'on découvre
 *     l'écart une fois l'offre en ligne, quand elle n'est plus modifiable.
 *
 * Quand il n'y a rien à reprendre, on le dit aussi — et on dit ce qui a été
 * fait à la place : les deux textes ont été RÉDIGÉS pour l'Apec à partir de la
 * fiche de poste (cf. la route `offer-text`). Le geste de re-rédaction vit sous
 * chaque champ, au plus près du texte qu'il remplace, et non ici : un bouton
 * en tête de bloc ne dit pas lequel des deux il va réécrire.
 */
import { ADEP_PREFILL_SNAPSHOT_NOTICE } from '@/lib/jobboards/adep/panel-state';
import type { AdepPrefill } from '@/lib/jobboards/adep/prefill';

export type ApecPrefillNoticeProps = {
  prefill: AdepPrefill | null;
};

const boxStyle = {
  margin: '0 0 12px',
  padding: '8px 10px',
  borderRadius: 6,
  background: 'var(--dash-surface-muted, rgba(0,0,0,0.03))',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dash-text-secondary)',
} as const;

export function ApecPrefillNotice({ prefill }: ApecPrefillNoticeProps) {
  if (!prefill) {
    return (
      <div style={boxStyle}>
        <div>
          Aucune annonce générique publiée pour cette campagne : l’intitulé vient
          de la fiche de poste, et les deux textes ci-dessous ont été rédigés
          pour l’Apec à partir d’elle — à relire avant publication.
        </div>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <div>
        Titre et descriptif repris de l’{prefill.label} ; le profil recherché a
        été rédigé pour l’Apec. Tout reste modifiable ici — le format de l’Apec
        n’est pas celui du canal générique, et « Rédiger à nouveau », sous
        chaque champ, réécrit le texte concerné.
      </div>
      <div style={{ marginTop: 4 }}>{ADEP_PREFILL_SNAPSHOT_NOTICE}</div>
    </div>
  );
}
