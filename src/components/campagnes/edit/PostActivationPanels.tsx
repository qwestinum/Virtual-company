'use client';

/**
 * Les surfaces de la campagne qui n'ouvrent qu'APRÈS l'activation, sur l'écran
 * qui suit la création : annonces à publier (générique, APEC) et présélection
 * vivier.
 *
 * Pourquoi pas avant : publier une annonce ou inviter un profil du vivier fait
 * arriver des candidatures, et le chemin email n'analyse que celles d'une
 * campagne `active` — diffuser depuis un brouillon, c'est appeler des CV qui ne
 * seront pas traités. L'ordre est donc imposé par l'écran : on active, puis on
 * diffuse.
 *
 * Tant que la campagne est en brouillon, on ne se contente pas de masquer : on
 * DIT ce qui s'ouvrira ici et à quelle condition. Une surface retirée sans un
 * mot ne se déplace pas, elle disparaît.
 */

import { VivierPreselectionPanel } from '@/components/vivier/VivierPreselectionPanel';
import { listPostActivationSurfaces } from '@/lib/campaign/post-activation-surfaces';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { PUBLICATION_CHANNEL_LABELS } from '@/types/publication-channel';

import { ChannelContentPanel } from './ChannelContentPanel';
import { Notice } from './created-step-parts';

export function PostActivationPanels({
  campaign,
  active,
}: {
  campaign: ActiveCampaign;
  active: boolean;
}) {
  const { contentChannels, vivier, any } = listPostActivationSurfaces(
    campaign.publishedChannels,
    campaign.sources,
  );
  if (!any) return null;

  if (!active) {
    const pieces = [
      ...contentChannels.map(
        (c) => `l’annonce ${PUBLICATION_CHANNEL_LABELS[c]}`,
      ),
      ...(vivier ? ['la présélection dans le vivier'] : []),
    ];
    return (
      <Notice tone="yellow">
        {joinFr(pieces)} s’ouvre{pieces.length > 1 ? 'nt' : ''}{' '}
        <strong>ici même, dès l’activation</strong> : une candidature reçue sur
        une campagne en brouillon n’est pas analysée, donc rien ne part avant.
      </Notice>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {contentChannels.map((channel) => (
        <ChannelContentPanel
          key={channel}
          channel={channel}
          campaignId={campaign.id}
        />
      ))}
      {vivier ? (
        <section
          style={{
            border: '1px solid var(--dash-border)',
            borderRadius: 12,
            padding: '12px 14px',
            background: 'var(--dash-surface)',
          }}
        >
          <h4
            className="font-display"
            style={{
              margin: '0 0 8px',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--dash-text)',
            }}
          >
            🗂️ Vivier — présélection
          </h4>
          <VivierPreselectionPanel campaignId={campaign.id} />
        </section>
      ) : null}
    </div>
  );
}

/** « a », « a et b », « a, b et c ». */
function joinFr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}
