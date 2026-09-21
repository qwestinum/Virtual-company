'use client';

/**
 * « Diffuser l'annonce » — le contenu publiable des canaux de la campagne, et
 * rien d'autre.
 *
 * ⚠️ Le contenu d'un canal AGIT SUR LE MONDE : publier fait arriver de vraies
 * candidatures, et le chemin email n'analyse que celles d'une campagne active.
 * L'écran ne s'ouvre donc que sur une campagne lancée — et sur un brouillon on
 * ne masque pas en silence, on dit ce qui s'ouvrira ici et à quelle condition.
 */

import Link from 'next/link';

import { listPostActivationSurfaces } from '@/lib/campaign/post-activation-surfaces';

import { CampaignFocusScreen } from './CampaignFocusScreen';
import { ChannelContentPanel } from './edit/ChannelContentPanel';

export function CampaignAnnonceScreen({ campaignId }: { campaignId: string }) {
  return (
    <CampaignFocusScreen
      campaignId={campaignId}
      titre="Diffuser l’annonce"
      sousTitre="Rédigez, relisez, puis figez le texte publié. La référence de la campagne voyage avec lui."
    >
      {(campaign) => {
        const { contentChannels } = listPostActivationSurfaces(
          campaign.publishedChannels,
          campaign.sources,
        );
        if (campaign.status !== 'active') {
          return (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-orange)' }}>
              Cette campagne est encore en brouillon. L’annonce s’écrira ici dès
              son lancement : une candidature reçue sur une campagne non lancée
              n’est pas analysée, donc rien ne se diffuse avant.
            </p>
          );
        }
        if (contentChannels.length === 0) {
          return (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}>
              Aucun canal à contenu n’est retenu sur cette campagne. Ajoutez
              « Annonce générique » ou « APEC » depuis{' '}
              <Link
                href={`/campagnes?campagne=${encodeURIComponent(campaignId)}&ouvrir=channels`}
                style={{ color: 'var(--dash-blue)' }}
              >
                ses canaux de diffusion
              </Link>
              .
            </p>
          );
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {contentChannels.map((channel) => (
              // Pas de titre ajouté : chaque panneau porte déjà le nom de son
              // canal. En doubler un ferait lire « APEC / APEC ».
              <section key={channel} data-channel-content={channel}>
                <ChannelContentPanel channel={channel} campaignId={campaignId} />
              </section>
            ))}
          </div>
        );
      }}
    </CampaignFocusScreen>
  );
}
