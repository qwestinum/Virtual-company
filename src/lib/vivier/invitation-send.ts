/**
 * Envoi du message d'invitation à postuler (Session V3, §6). Réutilise le
 * mécanisme d'email existant (`sendEmail`, Resend). L'envoi est l'action qui
 * fait passer la proposition à `contacted` :
 *   - succès (`sent`) OU email non configuré (`skipped_no_config`, démo locale)
 *     ⇒ on marque `contacted` (la décision est actée, l'email est best-effort) ;
 *   - échec dur (`send_failed`, réseau/API) ⇒ on NE marque PAS (re-tentable).
 *
 * C'est une invitation à CANDIDATER (jamais à un entretien). Server-only.
 */

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getVivierCandidate } from '@/lib/db/repos/vivier';
import { markContacted } from '@/lib/db/repos/vivier-preselection';
import { getSenderEmail } from '@/lib/email/addresses';
import { sendEmail } from '@/lib/email/client';
import type { FDPInProgress } from '@/types/field-collection';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';
import type { ShortlistEntry } from '@/types/vivier-preselection';

import {
  invitationTextToHtml,
  renderVivierInvitation,
} from './invitation-template';

export type InvitationStatus =
  | 'sent'
  | 'skipped_no_config'
  | 'send_failed'
  | 'no_candidate'
  | 'no_campaign';

export type InvitationResult = { contacted: boolean; status: InvitationStatus };

function jobTitleOf(fdp: FDPInProgress): string {
  const v = fdp.fields.job_title?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : 'le poste à pourvoir';
}

function firstName(nom: string): string {
  return nom.trim().split(/\s+/)[0] ?? nom;
}

/**
 * Compose et envoie l'invitation à un candidat pour une campagne, puis marque
 * la proposition `contacted` (sauf échec dur). Idempotent : si la proposition
 * n'est plus `identified` (déjà contactée), markContacted ne la retouche pas.
 */
export async function sendVivierInvitation(
  campaignId: string,
  candidateId: string,
  actor: string,
): Promise<InvitationResult> {
  const candidate = await getVivierCandidate(candidateId);
  if (!candidate?.email) return { contacted: false, status: 'no_candidate' };
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { contacted: false, status: 'no_campaign' };

  const settings = await getAppSettings();
  const config = settings?.vivierConfig ?? DEFAULT_VIVIER_CONFIG;
  const intake = settings?.intakeEmail ?? '';
  const rgpdContact = intake || (await getSenderEmail()) || '';

  const jobTitle = jobTitleOf(campaign.fdp);
  const text = renderVivierInvitation(config.invitationTemplate, {
    prenom: candidate.prenom?.trim() || firstName(candidate.nom),
    jobTitle,
    campaignName: campaign.name,
    // Référence à quoter en objet = l'ID campagne (ce que le poller matche).
    reference: campaign.id,
    receptionAddress: intake || '(adresse de réception à configurer)',
    organisation: config.organisationName.trim() || 'L’équipe recrutement',
    rgpdContact,
  });

  const result = await sendEmail({
    to: candidate.email,
    // La référence est aussi dans NOTRE objet : si le candidat répond (replyTo =
    // adresse de réception), sa réponse conserve « Re: … (réf. CAMP-XXXX) » et
    // reste rattachable par le poller (match `includes`, le préfixe Re: n'y fait rien).
    subject: `Une opportunité : ${jobTitle} (réf. ${campaign.id})`,
    html: invitationTextToHtml(text),
    replyTo: intake || undefined,
  });

  const status: InvitationStatus = result.ok
    ? 'sent'
    : result.error === 'email_not_configured'
      ? 'skipped_no_config'
      : 'send_failed';

  let contacted = false;
  if (status === 'sent' || status === 'skipped_no_config') {
    const updated = await markContacted(campaignId, [candidateId], actor);
    contacted = updated.length > 0;
  }

  await appendJournalEntry({
    action: 'vivier_invitation_sent',
    actor,
    campaignId,
    payload: { candidateId, status, messageId: result.messageId },
  });

  return { contacted, status };
}

/**
 * Mode CONTACT AUTOMATIQUE (settings §9) : à l'issue de la présélection, envoie
 * l'invitation à toute la short-list `identified` (déjà plafonnée). No-op en
 * mode manuel. Séquentiel (doux pour les quotas) ; chaque envoi est best-effort
 * et marque `contacted`. La permission d'envoi est portée par le réglage `auto`.
 */
export async function autoContactIfEnabled(
  campaignId: string,
  entries: ShortlistEntry[],
): Promise<void> {
  const settings = await getAppSettings();
  const mode = settings?.vivierConfig?.contactMode ?? DEFAULT_VIVIER_CONFIG.contactMode;
  if (mode !== 'auto') return;
  for (const e of entries) {
    if (e.state !== 'identified') continue;
    await sendVivierInvitation(campaignId, e.candidateId, 'auto');
  }
}
