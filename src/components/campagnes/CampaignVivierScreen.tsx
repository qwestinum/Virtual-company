'use client';

/**
 * « Chercher dans le vivier » — la présélection de la campagne, seule à
 * l'écran. La décision se prend ICI (refonte lot 4) ; accepter envoie une
 * invitation à candidater.
 */

import { VivierPreselectionPanel } from '@/components/vivier/VivierPreselectionPanel';

import { CV_SOURCE_HINTS, CV_SOURCE_LABELS } from '@/types/cv-source';

import { CampaignFocusScreen } from './CampaignFocusScreen';
import { SurfaceOptIn } from './SurfaceOptIn';
import { activerFlux } from './useEnableSurface';

export function CampaignVivierScreen({ campaignId }: { campaignId: string }) {
  return (
    <CampaignFocusScreen
      campaignId={campaignId}
      titre="Chercher dans le vivier"
      sousTitre="Les profils de votre stock interne qui correspondent à ce poste. Accepter envoie une invitation à candidater."
    >
      {(campaign) =>
        campaign.status !== 'active' ? (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-orange)' }}>
            Cette campagne est encore en brouillon. La présélection s’ouvrira ici
            dès son lancement : inviter quelqu’un à candidater sur une campagne
            qui n’analyse rien serait le faire postuler dans le vide.
          </p>
        ) : campaign.sources.includes('vivier') ? (
          <VivierPreselectionPanel campaignId={campaignId} />
        ) : (
          // ⚠️ On PROPOSE, au lieu de renvoyer aux réglages : vouloir chercher
          // dans le vivier EST le moment où l'on décide de s'en servir.
          <SurfaceOptIn
            titre="Chercher dans le vivier ?"
            explication="Le vivier n’est pas encore une source de cette campagne. En l’activant, ORQA propose les profils de votre stock interne qui correspondent au poste ; vous décidez ensuite qui inviter à candidater."
            choix={[
              {
                key: 'vivier',
                label: CV_SOURCE_LABELS.vivier,
                detail: CV_SOURCE_HINTS.vivier,
              },
            ]}
            onChoisir={() => activerFlux(campaignId, 'vivier')}
          />
        )
      }
    </CampaignFocusScreen>
  );
}
