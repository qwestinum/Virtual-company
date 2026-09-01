/**
 * Destinataires de SYNTHÈSE d'une campagne (server-only) — briefs
 * d'entretien, notices.
 *
 * Par défaut : l'adresse du RECRUTEUR RÉFÉRENT de la campagne (actif) EN
 * PLUS des adresses de synthèse configurées (Paramètres) — le référent
 * reçoit toujours les briefs de SES campagnes sans devoir figurer dans la
 * liste globale. Dédup insensible à la casse : si son adresse est déjà
 * configurée, un seul envoi. Fail-soft : tout échec de résolution du
 * référent ⇒ la liste configurée seule (comportement historique).
 *
 * PRINCIPAL vs COPIE (01/09/2026) : le message s'adresse au RÉFÉRENT — lui
 * seul est destinataire principal ; les adresses de synthèse sont mises en
 * COPIE. C'est ce que ferait une équipe RH réelle : on écrit à la personne
 * qui doit agir, on tient les autres informés. Sans référent, la place de
 * principal revient à la 1re adresse de synthèse : un message sans
 * destinataire principal n'est pas expédiable, et le fournisseur le
 * rejetterait — on ne remplace pas une convention de politesse par un envoi
 * qui n'arrive à personne.
 */

import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSynthesisEmails } from '@/lib/email/addresses';

/**
 * Une adresse est-elle EXPÉDIABLE ? Contrôle volontairement minimal — on ne
 * cherche pas à valider une adresse (personne n'y arrive par une expression
 * régulière), seulement à écarter ce qui n'en est manifestement pas une.
 */
export function isSendableAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

/**
 * Fusion PURE référent + configurées, dédup insensible à la casse (l'ordre
 * garde le référent en tête, puis les configurées dans leur ordre).
 *
 * Les entrées qui ne sont pas des adresses sont ÉCARTÉES plutôt que
 * transmises. Le fournisseur d'envoi rejette un message dès qu'UN destinataire
 * est invalide : une seule saisie ratée faisait donc échouer le briefing pour
 * tout le monde, sans que personne ne le sache. Incident réel — le seed du
 * runbook a laissé la chaîne `ton-email-de-connexion` comme adresse de
 * l'administrateur, référent de trois campagnes (dev, 17/08/2026).
 *
 * `rejected` remonte ce qui a été écarté : l'appelant le trace, pour qu'une
 * adresse fautive se voie au lieu de disparaître.
 */
export function mergeSynthesisRecipients(
  ownerEmail: string | null,
  configured: string[],
): string[] {
  return splitSynthesisRecipients(ownerEmail, configured).recipients;
}

export function splitSynthesisRecipients(
  ownerEmail: string | null,
  configured: string[],
): { recipients: string[]; rejected: string[] } {
  const recipients: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const email of [ownerEmail, ...configured]) {
    const clean = email?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isSendableAddress(clean)) recipients.push(clean);
    else rejected.push(clean);
  }
  return { recipients, rejected };
}

/** Email du référent ACTIF d'une campagne, ou null (fail-soft). */
async function ownerEmailFor(campaignId: string | null): Promise<string | null> {
  if (!campaignId || campaignId.startsWith('TASK-')) return null;
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign?.ownerUserId) return null;
    const recruiter = await getRecruiter(campaign.ownerUserId);
    if (!recruiter?.isActive) return null;
    return recruiter.email.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Répartition PURE entre destinataire principal (`to`) et copies (`cc`).
 *
 * Le principal est le RÉFÉRENT ; tout le reste — les adresses de synthèse
 * configurées — part en copie. Le référent n'apparaît jamais deux fois : la
 * dédup en amont l'a déjà retiré des configurées.
 *
 * Sans référent (aucun, désactivé, adresse non expédiable, ou hors contexte
 * campagne), la 1re adresse de synthèse tient la place du principal et les
 * suivantes restent en copie. `to` vide ⇒ il n'y a AUCUN destinataire du tout
 * (l'appelant garde son `no_recipient`), jamais un message en copie seule.
 */
export type SynthesisAudience = {
  to: string[];
  cc: string[];
  rejected: string[];
};

export function splitSynthesisAudience(
  ownerEmail: string | null,
  configured: string[],
): SynthesisAudience {
  const { recipients, rejected } = splitSynthesisRecipients(ownerEmail, configured);
  // `splitSynthesisRecipients` place déjà le référent en tête quand il est
  // expédiable : le premier de la liste EST le principal, dans les deux cas.
  return { to: recipients.slice(0, 1), cc: recipients.slice(1), rejected };
}

/**
 * Audience effective d'une campagne (null = pas de contexte campagne → liste
 * configurée seule). `to` vide = ni référent ni adresse configurée —
 * l'appelant garde son traitement `no_recipient`.
 */
export async function getSynthesisAudienceForCampaign(
  campaignId: string | null,
): Promise<SynthesisAudience> {
  const [configured, ownerEmail] = await Promise.all([
    getSynthesisEmails(),
    ownerEmailFor(campaignId),
  ]);
  const audience = splitSynthesisAudience(ownerEmail, configured);
  if (audience.rejected.length > 0) {
    // Trace SYSTÉMATIQUE : une adresse écartée est une configuration à
    // corriger, pas un détail. Sans elle, on remplacerait un échec bruyant
    // par un silence — l'inverse de ce qu'on cherche.
    console.error(
      `[synthesis-recipients] adresses écartées (invalides) pour ${campaignId ?? 'hors campagne'} : ${audience.rejected.join(', ')}`,
    );
  }
  return audience;
}

/**
 * Adresse SINGULIÈRE de synthèse d'une campagne (replyTo des mails candidat
 * invitation/refus) : le RÉFÉRENT en priorité, sinon la 1re adresse
 * configurée (repli env inclus), sinon null. NB : les mails dont la réponse
 * doit être RATTACHÉE par le poller (invitation vivier, sans-suite) gardent
 * leur replyTo = adresse de réception — ne pas les basculer ici.
 */
export async function getSynthesisReplyToForCampaign(
  campaignId: string | null,
): Promise<string | null> {
  return (await getSynthesisAudienceForCampaign(campaignId)).to[0] ?? null;
}
