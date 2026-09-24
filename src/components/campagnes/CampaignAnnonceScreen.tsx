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

import {
  CHANNELS_WITH_CONTENT,
  listPostActivationSurfaces,
} from '@/lib/campaign/post-activation-surfaces';
import {
  PUBLICATION_CHANNEL_LABELS,
  type PublicationChannel,
} from '@/types/publication-channel';

import { CampaignFocusScreen } from './CampaignFocusScreen';
import { SurfaceOptIn } from './SurfaceOptIn';
import { activerCanal } from './useEnableSurface';
import { useJobboardAvailable } from './useJobboardAvailable';
import { ChannelContentPanel } from './edit/ChannelContentPanel';

/** Ce que chaque canal implique, dit avant de le choisir. */
const DETAIL_CANAL: Record<string, string> = {
  generic:
    'Une annonce publiée sur votre page d’offres. Vous rédigez le texte, vous le figez, il porte la référence de la campagne.',
  apec: 'Dépôt de l’offre sur l’APEC. La publication part vers un service externe : elle se prépare ici, puis se confirme.',
};

export function CampaignAnnonceScreen({ campaignId }: { campaignId: string }) {
  const jobboard = useJobboardAvailable(campaignId);
  // Un canal ne se PROPOSE que s'il a où paraître (cf. useJobboardAvailable).
  const proposables = CHANNELS_WITH_CONTENT.filter((c) => c !== 'generic' || jobboard !== false);
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
          // ⚠️ On PROPOSE le canal ici. Renvoyer vers les réglages de la
          // campagne, c'était faire refaire le chemin pour une case à cocher —
          // alors que vouloir diffuser EST le moment où l'on choisit son canal.
          return (
            <SurfaceOptIn
              titre="Sur quel canal diffuser ?"
              explication="Aucun canal à contenu n’est encore retenu sur cette campagne. Choisissez-en un : il sera ajouté à ses canaux de diffusion, et vous pourrez rédiger l’annonce ici même."
              choix={proposables.map((c) => ({
                key: c,
                label: PUBLICATION_CHANNEL_LABELS[c],
                detail: DETAIL_CANAL[c],
              }))}
              onChoisir={(key) => activerCanal(campaignId, key as PublicationChannel)}
            />
          );
        }
        // ⚠️ Les canaux NON retenus restent proposés sous les panneaux : sans
        // ça, une campagne diffusée sur l'APEC ne pouvait plus jamais recevoir
        // d'annonce générique (le choix n'apparaissait qu'à zéro canal).
        const autres = proposables.filter((c) => !contentChannels.includes(c));
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {contentChannels.map((channel) => (
              // Pas de titre ajouté : chaque panneau porte déjà le nom de son
              // canal. En doubler un ferait lire « APEC / APEC ».
              <section key={channel} data-channel-content={channel}>
                <ChannelContentPanel channel={channel} campaignId={campaignId} />
              </section>
            ))}
            {autres.length > 0 && (
              <SurfaceOptIn
                titre="Diffuser aussi ailleurs ?"
                explication="Ce canal n’est pas encore retenu sur cette campagne. Le choisir l’ajoute à ses canaux de diffusion, et l’annonce se rédige ici même."
                choix={autres.map((c) => ({
                  key: c,
                  label: PUBLICATION_CHANNEL_LABELS[c],
                  detail: DETAIL_CANAL[c],
                }))}
                onChoisir={(key) => activerCanal(campaignId, key as PublicationChannel)}
              />
            )}
          </div>
        );
      }}
    </CampaignFocusScreen>
  );
}
