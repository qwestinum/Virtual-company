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
import {
  canEmitBookingLink,
  emitCampaignBookingLink,
  isNativeSchedulingCampaign,
  resolveCampaignMeetingLocation,
} from '@/lib/scheduling-host/campaign-booking';
import { resolveOrganizationName } from '@/types/branding';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  acceptanceSubject,
  interviewMailTextToHtml,
  rejectionSubject,
  rescheduleSubject,
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
 * POINT DE RÉSOLUTION UNIQUE du lien d'agenda pour une campagne — régime
 * HISTORIQUE (Cal.com) :
 *   1. référent (campaigns.owner_user_id) actif avec lien perso ;
 *   2. réglage global interviewConfig.agendaLink ;
 *   3. env CAL_COM_EVENT_URL (historique) ;
 *   4. '' ⇒ gate « invitation bloquée » (inchangé).
 * Toute surface qui fait partir un lien de réservation passe par ici (poller
 * IMAP, mail-composer envoi direct ET preview HITL — l'override HITL envoie
 * le HTML du preview tel quel, il suit mécaniquement).
 *
 * Le régime NATIF (flag `schedulingNative` de la campagne) ne passe PAS par
 * cette fonction : il n'a pas de lien statique à résoudre, il en émet un
 * nominatif par candidature (cf. `buildInterviewMail`).
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

/**
 * SONDE du gate d'envoi : une invitation peut-elle partir pour cette
 * campagne ? Appelée AVANT de savoir si le mail partira vraiment — donc
 * SANS EFFET : en régime natif elle vérifie que le référent peut recevoir des
 * réservations, elle n'émet aucun jeton. Émettre ici laisserait un lien
 * orphelin derrière chaque envoi avorté.
 */
export async function canInviteForCampaign(
  campaignId?: string | null,
): Promise<boolean> {
  if (campaignId && (await isNativeSchedulingCampaign(campaignId))) {
    return canEmitBookingLink(campaignId);
  }
  return (await getResolvedAgendaLink(campaignId)).length > 0;
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

/**
 * `reschedule` : le rendez-vous existait et tombe (le cabinet décale, ou le
 * candidat a annulé). Le message porte un lien, comme une invitation, mais
 * PAS l'annonce de sélection — la répéter à quelqu'un dont on déplace le
 * rendez-vous sonne faux, et il l'a déjà reçue.
 */
export type InterviewMailMode = 'invite' | 'reject' | 'reschedule';

/** Modes qui portent un lien de réservation. Le refus n'en fait JAMAIS partie. */
const LINK_BEARING_MODES: ReadonlySet<InterviewMailMode> = new Set([
  'invite',
  'reschedule',
]);

export type BuildInterviewMailArgs = {
  mode: InterviewMailMode;
  campaignId: string;
  jobTitle: string | null;
  candidate: MailCandidate;
  /** Brouillon HITL : compose même sans lien d'agenda (placeholder visible). */
  draft?: boolean;
  /**
   * Identifiant d'ANALYSE — clé d'idempotence du lien natif. Absent, aucune
   * invitation native ne peut être émise (on ne devine pas une clé : deux
   * clés différentes pour une même candidature, ce sont deux liens vivants).
   */
  analysisId?: string | null;
  /** uid d'analyse, transporté dans le contexte du lien (retrouve le briefing). */
  uid?: string | null;
  /**
   * Clé du lien à émettre. Vaut l'identifiant d'analyse dans le cas courant ;
   * une RÉINVITATION en fournit une nouvelle (le lien précédent est consommé
   * et ré-émettre avec la même clé rendrait fidèlement ce jeton mort).
   */
  linkKey?: string | null;
  /**
   * Phrase factuelle du message de nouveau créneau (`mode: 'reschedule'`) :
   * qui a décalé, et quand. Ignorée par les autres modes.
   */
  intro?: string | null;
};

export type BuildInterviewMailResult = {
  /** true ⇒ envoi à bloquer : acceptation réelle sans lien de réservation. */
  blocked: boolean;
  /**
   * Pourquoi l'envoi est bloqué — les deux régimes échouent pour des raisons
   * différentes, et le message rendu au DRH doit le dire.
   */
  blockedReason?:
    | 'agenda_link_not_configured'
    | 'native_link_unavailable'
    /**
     * Régime natif, référent réservable — mais AUCUN lieu d'entretien (ni sur
     * l'agenda du référent, ni en surcharge de campagne). Distinguée de
     * `native_link_unavailable` parce que le geste de réparation n'est pas le
     * même : renseigner un lieu, et non ouvrir des disponibilités.
     */
    | 'meeting_location_missing';
  mail: { subject: string; html: string };
};

/**
 * Lien de réservation d'une INVITATION, tous régimes confondus.
 *
 * Régime natif : un lien nominatif par candidature, émis (ou retrouvé —
 * l'émission est idempotente par analyse) ici et nulle part ailleurs.
 * Régime historique : la cascade Cal.com, inchangée.
 *
 * ⚠️ Appelée UNIQUEMENT pour `mode === 'invite'`. Un refus ne porte jamais de
 * lien — même si le modèle de refus contient le marqueur `[lien d'agenda]`,
 * cas réel dès qu'un DRH copie-colle son modèle d'acceptation.
 */
async function resolveInvitationLink(
  args: BuildInterviewMailArgs,
  config: InterviewConfig,
): Promise<{ link: string; reason?: BuildInterviewMailResult['blockedReason'] }> {
  if (await isNativeSchedulingCampaign(args.campaignId)) {
    if (!args.analysisId) {
      console.error(
        '[interview-mail] campagne en réservation native sans identifiant d’analyse',
        args.campaignId,
      );
      return { link: '', reason: 'native_link_unavailable' };
    }
    // Un lien ne s'émet pas vers un rendez-vous sans lieu : le candidat
    // réserverait un créneau sans savoir où il se tient, et le mail de
    // confirmation omettrait purement et simplement la ligne « Où ». La sonde
    // du gate a déjà vérifié ce point, mais elle a pu tourner il y a plusieurs
    // secondes — c'est ici que rien n'est encore parti.
    const place = await resolveCampaignMeetingLocation(args.campaignId);
    if (!place.resolved) {
      console.error(
        '[interview-mail] campagne en réservation native sans lieu d’entretien',
        args.campaignId,
      );
      return { link: '', reason: 'meeting_location_missing' };
    }
    const settings = await getAppSettings().catch(() => null);
    const url = await emitCampaignBookingLink({
      campaignId: args.campaignId,
      analysisId: args.analysisId,
      linkKey: args.linkKey ?? args.analysisId,
      uid: args.uid ?? null,
      candidateName: args.candidate.candidateName,
      candidateEmail: args.candidate.email ?? null,
      jobTitle: args.jobTitle,
      organizationName: resolveOrganizationName(settings),
    }).catch((err) => {
      console.error('[interview-mail] émission du lien de réservation KO', err);
      return null;
    });
    // Pas de repli vers Cal.com : sur une campagne basculée, le référent n'a
    // pas forcément de lien Cal.com, et en envoyer un serait pire que bloquer.
    return url ? { link: url } : { link: '', reason: 'native_link_unavailable' };
  }

  const link =
    (await ownerAgendaLink(
      (await fetchCampaignFacts(args.campaignId)).ownerUserId,
    )) || resolveAgendaLink(config);
  return link ? { link } : { link: '', reason: 'agenda_link_not_configured' };
}

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

  // VERROU : un refus ne déclenche aucune résolution, donc aucune émission de
  // lien. C'est ce qui protège du modèle de refus contenant `[lien d'agenda]`.
  // La règle porte sur l'ENSEMBLE des modes porteurs de lien, pas sur le seul
  // « invite » — ajouter un mode ne doit pas rouvrir le trou par distraction.
  const carriesLink = LINK_BEARING_MODES.has(args.mode);
  const resolved = carriesLink
    ? await resolveInvitationLink(args, config)
    : { link: '' };
  const agendaLink = resolved.link;

  // Seule validation : un message réellement envoyé qui promet un créneau doit
  // porter un lien. Le refus n'est jamais concerné.
  if (carriesLink && !agendaLink && !args.draft) {
    return {
      blocked: true,
      blockedReason: resolved.reason ?? 'agenda_link_not_configured',
      mail: { subject: '', html: '' },
    };
  }
  const displayJobTitle = args.jobTitle?.trim() || facts.jobTitle || null;
  const bodyJobTitle = displayJobTitle ?? 'le poste à pourvoir';
  const { prenom, nom } = splitCandidateName(args.candidate.candidateName);
  const organisation = config.organisationName.trim() || ORG_FALLBACK;

  const template =
    args.mode === 'reject'
      ? config.rejectionTemplate
      : args.mode === 'reschedule'
        ? (config.rescheduleTemplate ?? DEFAULT_INTERVIEW_CONFIG.rescheduleTemplate)
        : config.acceptanceTemplate;

  const text = renderInterviewMail(template, {
      prenom,
      nom,
      jobTitle: bodyJobTitle,
      campaignName: facts.name ?? args.campaignId,
      organisation,
      recruiterName: config.recruiterName.trim() || organisation,
      agendaLink: agendaLink || AGENDA_PLACEHOLDER,
      intro: args.intro ?? '',
  });

  const subject =
    args.mode === 'reject'
      ? rejectionSubject(displayJobTitle)
      : args.mode === 'reschedule'
        ? rescheduleSubject(displayJobTitle)
        : acceptanceSubject(displayJobTitle);

  return { blocked: false, mail: { subject, html: interviewMailTextToHtml(text) } };
}
