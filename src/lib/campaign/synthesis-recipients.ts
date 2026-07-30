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
 */

import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSynthesisEmails } from '@/lib/email/addresses';

/** Fusion PURE référent + configurées, dédup insensible à la casse (l'ordre
 * garde le référent en tête, puis les configurées dans leur ordre). */
export function mergeSynthesisRecipients(
  ownerEmail: string | null,
  configured: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const email of [ownerEmail, ...configured]) {
    const clean = email?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
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
 * Destinataires effectifs pour une campagne (null = pas de contexte campagne
 * → liste configurée seule). Liste vide possible : ni référent ni adresse
 * configurée — l'appelant garde son traitement `no_recipient`.
 */
export async function getSynthesisRecipientsForCampaign(
  campaignId: string | null,
): Promise<string[]> {
  const [configured, ownerEmail] = await Promise.all([
    getSynthesisEmails(),
    ownerEmailFor(campaignId),
  ]);
  return mergeSynthesisRecipients(ownerEmail, configured);
}
