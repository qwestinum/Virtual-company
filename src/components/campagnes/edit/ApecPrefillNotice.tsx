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
 * Quand il n'y a rien à reprendre, on le dit aussi, et on propose de
 * pré-rédiger — un geste, jamais un automatisme (cf. la route `draft-text`).
 */
import { ADEP_PREFILL_SNAPSHOT_NOTICE } from '@/lib/jobboards/adep/panel-state';
import type { AdepPrefill } from '@/lib/jobboards/adep/prefill';

import { ghostBtn } from './job-ad-panel-styles';

export type ApecPrefillNoticeProps = {
  prefill: AdepPrefill | null;
  drafting: boolean;
  onDraft: () => void;
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

export function ApecPrefillNotice({ prefill, drafting, onDraft }: ApecPrefillNoticeProps) {
  if (!prefill) {
    return (
      <div style={boxStyle}>
        <div>
          Aucune annonce générique publiée pour cette campagne : l’intitulé vient
          de la fiche de poste, le descriptif est à écrire.
        </div>
        <button
          type="button"
          style={{ ...ghostBtn, marginTop: 8 }}
          onClick={onDraft}
          disabled={drafting}
        >
          {drafting ? 'Rédaction en cours…' : 'Pré-rédiger le texte'}
        </button>
      </div>
    );
  }

  // Une pré-rédaction n'a été relue par personne : on peut la refaire sans rien
  // perdre. Un texte publié, si — le bouton disparaît plutôt que d'offrir
  // d'écraser ce qu'un humain a validé.
  const rewritable = prefill.source === 'job_writer';

  return (
    <div style={boxStyle}>
      <div>
        Titre et descriptif repris de l’{prefill.label}. Ils restent modifiables
        ici — le format de l’Apec n’est pas celui du canal générique.
      </div>
      <div style={{ marginTop: 4 }}>{ADEP_PREFILL_SNAPSHOT_NOTICE}</div>
      {rewritable ? (
        <button
          type="button"
          style={{ ...ghostBtn, marginTop: 8 }}
          onClick={onDraft}
          disabled={drafting}
        >
          {drafting ? 'Rédaction en cours…' : 'Pré-rédiger à nouveau'}
        </button>
      ) : null}
    </div>
  );
}
