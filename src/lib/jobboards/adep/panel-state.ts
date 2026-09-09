/**
 * Ce que le panneau APEC affiche, dérivé de l'état. PUR.
 *
 * Sorti du composant parce que ce sont des DÉCISIONS, pas de la présentation :
 * quel bouton proposer, à partir de quand la republication devient impossible,
 * comment nommer un statut. Elles se testent sans rendu, et c'est ce qui
 * permet de vérifier la règle des 30 jours sans monter un navigateur.
 */

/** Fenêtre de republication de l'Apec (API_361). */
export const REPUBLISH_WINDOW_DAYS = 30;

/** Le signal s'allume une semaine avant la fermeture. */
export const REPUBLISH_WARNING_DAYS = 7;

export type AdepPanelPhase =
  | 'none'
  | 'awaiting_validation'
  | 'published'
  | 'suspended'
  | 'closed'
  | 'failed'
  | 'uncertain';

/** Libellés d'état, tels que le recruteur doit les lire. */
export const ADEP_STATUS_LABELS: Record<string, string> = {
  AVALIDER: 'En attente de validation par un consultant Apec',
  PUBLIEE: 'Publiée',
  SUSPENDUE: 'Suspendue',
  FERMEE: 'Fermée',
  AMODIFIER: 'À modifier',
};

export type PostingLike = {
  attemptState: 'reserved' | 'sent' | 'acknowledged' | 'failed';
  remoteStatus: string | null;
  publishedAt: string | null;
  apecPositionNumero: string | null;
};

/** Phase d'affichage. PUR. */
export function adepPhase(posting: PostingLike | null): AdepPanelPhase {
  if (!posting) return 'none';
  // ⚠️ `sent` sans acquittement = « on ne sait pas si l'offre existe ». C'est
  // la seule phase où l'on ne propose NI publier NI republier : le geste sûr
  // est d'aller vérifier chez l'Apec.
  if (posting.attemptState === 'sent') return 'uncertain';
  if (posting.attemptState === 'failed') return 'failed';
  switch (posting.remoteStatus) {
    case 'PUBLIEE':
      return 'published';
    case 'SUSPENDUE':
      return 'suspended';
    case 'FERMEE':
      return 'closed';
    case 'AVALIDER':
    case 'AMODIFIER':
      return 'awaiting_validation';
    default:
      return posting.apecPositionNumero ? 'awaiting_validation' : 'failed';
  }
}

/**
 * Jours restants avant que la republication devienne impossible.
 *
 * ⚠️ La fenêtre court depuis la PUBLICATION, pas depuis la suspension : une
 * offre publiée le 1er et suspendue le 28 n'a plus que deux jours. Compter
 * depuis la suspension donnerait trente jours de plus, et le bouton
 * disparaîtrait sans prévenir au moment où quelqu'un s'en sert.
 *
 * `null` quand la date de publication est inconnue — on n'invente pas une
 * échéance sur une donnée absente.
 */
export function republishDaysLeft(
  publishedAt: string | null,
  now: Date,
): number | null {
  if (!publishedAt) return null;
  const start = Date.parse(publishedAt);
  if (!Number.isFinite(start)) return null;
  const elapsed = Math.floor((now.getTime() - start) / 86_400_000);
  return REPUBLISH_WINDOW_DAYS - elapsed;
}

/** La republication est-elle encore offerte ? PUR. */
export function canRepublish(posting: PostingLike | null, now: Date): boolean {
  if (!posting || adepPhase(posting) !== 'suspended') return false;
  const left = republishDaysLeft(posting.publishedAt, now);
  // Date de publication inconnue : on LAISSE le bouton. L'Apec tranchera, et
  // son refus est explicite (API_361) — le retirer sur un doute priverait d'un
  // geste légitime.
  return left === null || left > 0;
}

/**
 * La phrase qui accompagne la fenêtre. Elle DIT toujours quelque chose : un
 * bouton retiré sans explication ne déplace pas le besoin, il le supprime.
 */
export function republishNotice(
  posting: PostingLike | null,
  now: Date,
): string | null {
  if (!posting) return null;
  const phase = adepPhase(posting);
  if (phase !== 'published' && phase !== 'suspended') return null;
  const left = republishDaysLeft(posting.publishedAt, now);
  if (left === null) return null;
  if (left <= 0) {
    return "La fenêtre de republication de l'Apec est fermée (30 jours après la publication) : il faut créer une nouvelle offre.";
  }
  const deadline = new Date(
    Date.parse(posting.publishedAt!) + REPUBLISH_WINDOW_DAYS * 86_400_000,
  );
  const formatted = deadline.toLocaleDateString('fr-FR');
  return phase === 'suspended'
    ? `Republication possible jusqu'au ${formatted} (${left} jour${left > 1 ? 's' : ''}).`
    : `Republication possible jusqu'au ${formatted}.`;
}

/**
 * L'avertissement permanent. Affiché AVANT et APRÈS publication, parce que
 * `updatePosition` est désactivé côté Apec et que personne ne le devine.
 */
/**
 * Le texte APEC est une COPIE, prise à l'ouverture du panneau.
 *
 * Il n'y a pas de lien vivant entre l'annonce générique et l'offre Apec, et
 * c'est voulu : ce qui part chez l'Apec est figé à SA publication, comme le
 * snapshot du canal générique l'est à la sienne. Sans cette phrase, on
 * corrigerait une coquille dans l'annonce générique en croyant corriger les
 * deux — et on ne s'en apercevrait qu'une fois l'offre en ligne, quand elle
 * n'est plus modifiable.
 */
export const ADEP_PREFILL_SNAPSHOT_NOTICE =
  "C'est une copie : modifier l'annonce générique plus tard ne changera rien à ce qui part chez l'Apec.";

export const ADEP_IMMUTABLE_NOTICE =
  "Une fois publiée, l'annonce n'est plus modifiable depuis ORQA. Toute correction passe par apec.fr ou par le support Apec.";
