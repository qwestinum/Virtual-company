/**
 * Publisher — simulation (Session 5 round 4).
 *
 * Pas d'intégration réelle LinkedIn / Indeed / WTTJ — ces APIs
 * demandent des access tokens dédiés et un setup non MVP. Le
 * Publisher produit donc une « preuve de publication » crédible :
 * URL fictive cohérente avec le channel, timestamp réel, statut
 * `publié`. C'est suffisant pour donner le sentiment d'une équipe au
 * travail en démo.
 *
 * Le mock est volontairement transparent dans les commentaires : le
 * code n'essaye pas de faire croire qu'il publie réellement, c'est
 * la couche UX qui produit l'illusion (bulle Manager, carte agent
 * busy puis idle, etc.).
 */

import {
  type PublicationChannel,
  PUBLICATION_CHANNEL_LABELS,
} from '@/types/publication-channel';

export type PublicationProof = {
  channel: PublicationChannel;
  channelLabel: string;
  url: string;
  postId: string;
  publishedAt: string;
};

function pseudoPostId(): string {
  // 13 caractères alphanum, suffisamment crédible pour un slug réseau.
  return Math.random().toString(36).slice(2, 9) +
    Math.random().toString(36).slice(2, 8);
}

function buildChannelUrl(channel: PublicationChannel, postId: string): string {
  switch (channel) {
    case 'linkedin':
      return `https://www.linkedin.com/jobs/view/${postId}`;
    case 'indeed':
      return `https://fr.indeed.com/viewjob?jk=${postId}`;
    case 'welcome_to_the_jungle':
      return `https://www.welcometothejungle.com/fr/companies/qwestinum/jobs/${postId}`;
    case 'apec':
      return `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail/offre/${postId}`;
    case 'france_travail':
      return `https://candidat.francetravail.fr/offres/recherche/detail/${postId}`;
    case 'generic':
      return `https://qwestinum.com/jobs/${postId}`;
  }
}

export function simulatePublication(channel: PublicationChannel): PublicationProof {
  const postId = pseudoPostId();
  return {
    channel,
    channelLabel: PUBLICATION_CHANNEL_LABELS[channel],
    url: buildChannelUrl(channel, postId),
    postId,
    publishedAt: new Date().toISOString(),
  };
}

/**
 * Rendu markdown de la preuve, déposé dans Storage en artefact `other`.
 * Utile pour reconstituer le flux côté audit.
 */
export function renderPublicationProofMarkdown(proof: PublicationProof): string {
  const date = new Date(proof.publishedAt).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  return [
    `# Preuve de publication — ${proof.channelLabel}`,
    '',
    `- **Canal** : ${proof.channelLabel}`,
    `- **URL** : ${proof.url}`,
    `- **Post ID** : \`${proof.postId}\``,
    `- **Publié le** : ${date}`,
    '',
    'Note interne : publication simulée — l\'intégration réelle des jobboards demande des access tokens dédiés. Le post id et l\'URL sont générés par convention pour donner une trace cohérente côté démo.',
  ].join('\n');
}
