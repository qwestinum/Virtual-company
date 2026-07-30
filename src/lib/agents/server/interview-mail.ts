/**
 * Construction serveur des messages candidat d'entretien (acceptation+invitation
 * et refus). Server-only — lit les réglages (interviewConfig) et le nom de la
 * campagne, puis délègue le rendu DÉTERMINISTE aux templates purs
 * (`@/lib/interview/mail-templates`). Remplace l'ancienne génération LLM
 * (`composeCandidateMail`) : plus aucun appel modèle pour le corps des mails.
 *
 * Gating du lien d'agenda : pour une ACCEPTATION envoyée réellement (hors
 * brouillon HITL), un lien d'agenda configuré est OBLIGATOIRE — sinon l'envoi
 * est bloqué (le caller répond « lien d'agenda non configuré dans les
 * paramètres »). En brouillon, on compose quand même avec un placeholder
 * visible que le DRH complète avant l'envoi.
 */

import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  acceptanceSubject,
  interviewMailTextToHtml,
  rejectionSubject,
  renderInterviewMail,
  splitCandidateName,
} from '@/lib/interview/mail-templates';
import type { MailCandidate } from '@/types/mail-candidate';
import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';

const ORG_FALLBACK = 'L’équipe recrutement';
const AGENDA_PLACEHOLDER = '(lien d’agenda à configurer)';

/** Lien d'agenda GLOBAL : réglage org-level, repli sur l'env historique. */
export function resolveAgendaLink(config: InterviewConfig): string {
  return config.agendaLink.trim() || (process.env.CAL_COM_EVENT_URL ?? '').trim();
}

/**
 * Lien Cal.com PERSONNEL du recruteur référent d'une campagne, ou null.
 * Fail-soft à CHAQUE étage (référent absent, DÉSACTIVÉ, sans lien, table
 * absente, hoquet DB ⇒ null → le caller retombe sur le lien global) —
 * migration comportementale douce : rien ne casse tant que les référents ne
 * sont pas posés.
 */
async function ownerAgendaLink(ownerUserId: string | null): Promise<string | null> {
  if (!ownerUserId) return null;
  try {
    const recruiter = await getRecruiter(ownerUserId);
    if (!recruiter?.isActive) return null;
    return recruiter.calcomLink?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * POINT DE RÉSOLUTION UNIQUE du lien d'agenda pour une campagne :
 *   1. référent (campaigns.owner_user_id) actif avec lien perso ;
 *   2. réglage global interviewConfig.agendaLink ;
 *   3. env CAL_COM_EVENT_URL (historique) ;
 *   4. '' ⇒ gate « invitation bloquée » (inchangé).
 * Toute surface qui fait partir un lien de réservation passe par ici (poller
 * IMAP, mail-composer envoi direct ET preview HITL — l'override HITL envoie
 * le HTML du preview tel quel, il suit mécaniquement).
 */
export async function getResolvedAgendaLink(
  campaignId?: string | null,
): Promise<string> {
  if (campaignId && !campaignId.startsWith('TASK-')) {
    const facts = await fetchCampaignFacts(campaignId);
    const personal = await ownerAgendaLink(facts.ownerUserId);
    if (personal) return personal;
  }
  const settings = await getAppSettings();
  return resolveAgendaLink(settings?.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG);
}

/** Récupère nom + intitulé + référent d'une campagne (best-effort, jamais throw). */
async function fetchCampaignFacts(campaignId: string): Promise<{
  name: string | null;
  jobTitle: string | null;
  ownerUserId: string | null;
}> {
  if (campaignId.startsWith('TASK-')) {
    return { name: null, jobTitle: null, ownerUserId: null };
  }
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign) return { name: null, jobTitle: null, ownerUserId: null };
    const raw = campaign.fdp.fields.job_title?.value;
    const jobTitle = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    return { name: campaign.name, jobTitle, ownerUserId: campaign.ownerUserId };
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[interview-mail] getCampaign failed', err);
    }
    return { name: null, jobTitle: null, ownerUserId: null };
  }
}

export type BuildInterviewMailArgs = {
  mode: 'invite' | 'reject';
  campaignId: string;
  jobTitle: string | null;
  candidate: MailCandidate;
  /** Brouillon HITL : compose même sans lien d'agenda (placeholder visible). */
  draft?: boolean;
};

export type BuildInterviewMailResult = {
  /** true ⇒ envoi à bloquer : acceptation réelle sans lien d'agenda configuré. */
  blocked: boolean;
  mail: { subject: string; html: string };
};

/**
 * Compose le message candidat (acceptation+invitation ou refus) par rendu
 * déterministe du template configuré. Pour une acceptation réelle sans lien
 * d'agenda, renvoie `blocked: true` (le caller refuse l'envoi).
 */
export async function buildInterviewMail(
  args: BuildInterviewMailArgs,
): Promise<BuildInterviewMailResult> {
  const settings = await getAppSettings();
  const config = settings?.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG;
  const facts = await fetchCampaignFacts(args.campaignId);
  // Résolution PAR CAMPAGNE : lien perso du référent > global > env.
  const agendaLink =
    (await ownerAgendaLink(facts.ownerUserId)) || resolveAgendaLink(config);

  // Seule validation : pour une acceptation réellement envoyée, le lien
  // d'agenda doit être configuré. Le refus n'est jamais concerné.
  if (args.mode === 'invite' && !agendaLink && !args.draft) {
    return { blocked: true, mail: { subject: '', html: '' } };
  }
  const displayJobTitle = args.jobTitle?.trim() || facts.jobTitle || null;
  const bodyJobTitle = displayJobTitle ?? 'le poste à pourvoir';
  const { prenom, nom } = splitCandidateName(args.candidate.candidateName);
  const organisation = config.organisationName.trim() || ORG_FALLBACK;

  const text = renderInterviewMail(
    args.mode === 'invite' ? config.acceptanceTemplate : config.rejectionTemplate,
    {
      prenom,
      nom,
      jobTitle: bodyJobTitle,
      campaignName: facts.name ?? args.campaignId,
      organisation,
      recruiterName: config.recruiterName.trim() || organisation,
      agendaLink: agendaLink || AGENDA_PLACEHOLDER,
    },
  );

  const subject =
    args.mode === 'invite'
      ? acceptanceSubject(displayJobTitle)
      : rejectionSubject(displayJobTitle);

  return { blocked: false, mail: { subject, html: interviewMailTextToHtml(text) } };
}
