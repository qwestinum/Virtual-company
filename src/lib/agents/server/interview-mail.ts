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

/** Lien d'agenda effectif : réglage org-level, repli sur l'env historique. */
export function resolveAgendaLink(config: InterviewConfig): string {
  return config.agendaLink.trim() || (process.env.CAL_COM_EVENT_URL ?? '').trim();
}

/** Charge les réglages et renvoie le lien d'agenda résolu (vide si non configuré). */
export async function getResolvedAgendaLink(): Promise<string> {
  const settings = await getAppSettings();
  return resolveAgendaLink(settings?.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG);
}

/** Récupère le nom + l'intitulé de poste d'une campagne (best-effort, jamais throw). */
async function fetchCampaignFacts(
  campaignId: string,
): Promise<{ name: string | null; jobTitle: string | null }> {
  if (campaignId.startsWith('TASK-')) return { name: null, jobTitle: null };
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign) return { name: null, jobTitle: null };
    const raw = campaign.fdp.fields.job_title?.value;
    const jobTitle = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    return { name: campaign.name, jobTitle };
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[interview-mail] getCampaign failed', err);
    }
    return { name: null, jobTitle: null };
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
  const agendaLink = resolveAgendaLink(config);

  // Seule validation : pour une acceptation réellement envoyée, le lien
  // d'agenda doit être configuré. Le refus n'est jamais concerné.
  if (args.mode === 'invite' && !agendaLink && !args.draft) {
    return { blocked: true, mail: { subject: '', html: '' } };
  }

  const facts = await fetchCampaignFacts(args.campaignId);
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
