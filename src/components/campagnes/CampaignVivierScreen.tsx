'use client';

/**
 * « Chercher dans le vivier » — la présélection de la campagne, seule à
 * l'écran. La décision se prend ICI (refonte lot 4) ; accepter envoie une
 * invitation à candidater.
 */

import { VivierPreselectionPanel } from '@/components/vivier/VivierPreselectionPanel';

import { CampaignFocusScreen } from './CampaignFocusScreen';

export function CampaignVivierScreen({ campaignId }: { campaignId: string }) {
  return (
    <CampaignFocusScreen
      campaignId={campaignId}
      titre="Chercher dans le vivier"
      sousTitre="Les profils de votre stock interne qui correspondent à ce poste. Accepter envoie une invitation à candidater."
    >
      {(campaign) =>
        campaign.status === 'active' ? (
          <VivierPreselectionPanel campaignId={campaignId} />
        ) : (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-orange)' }}>
            Cette campagne est encore en brouillon. La présélection s’ouvrira ici
            dès son lancement : inviter quelqu’un à candidater sur une campagne
            qui n’analyse rien serait le faire postuler dans le vide.
          </p>
        )
      }
    </CampaignFocusScreen>
  );
}
