/**
 * Résumés d'état des sections de réglages — PURS.
 *
 * Une section repliée doit dire ce qu'elle contient, sinon on la déplie « pour
 * voir » et on a juste déplacé le problème. Trois d'entre elles portent en plus
 * un signal d'attention, parce que mal réglées elles cassent le pipeline en
 * SILENCE :
 *   - aucune adresse de synthèse cochée ⇒ les briefings d'entretien ne partent
 *     à personne ;
 *   - pas de clé Resend ⇒ aucun mail candidat ne part ;
 *   - pas de lien d'agenda ⇒ les acceptations sont bloquées à l'envoi (sauf
 *     campagnes en réservation native, qui n'en ont pas besoin).
 *
 * Sorti du composant pour être testable : ces phrases sont la seule chose que
 * l'utilisateur lit avant de décider quoi ouvrir.
 */
import type { SectionStatus } from '@/components/settings/SettingsSection';
import { missingAdepSettings, type AdepConfig } from '@/types/adep-settings';
import type { BrandingConfig } from '@/types/branding';
import type { InterviewConfig } from '@/types/interview-settings';
import type { VivierConfig } from '@/types/vivier-settings';

export type SectionState = { summary: string; status: SectionStatus };

/** Ce que le hub connaît sans rien recharger. */
export type SummarySource = {
  synthesisEmails: string[];
  synthesisEmailsActive: string[];
  senderEmail: string | null;
  senderEmails: string[];
  resendApiKeyConfigured: boolean;
  interviewConfig: InterviewConfig;
  vivierConfig: VivierConfig;
  brandingConfig: BrandingConfig;
  adepConfig: AdepConfig;
  fluxConfigured: number;
  channelsConfigured: number;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n > 1 ? many : one}`;
}

export function synthesisSummary(s: SummarySource): SectionState {
  if (s.synthesisEmails.length === 0) {
    return { summary: 'Aucune adresse enregistrée', status: 'warn' };
  }
  if (s.synthesisEmailsActive.length === 0) {
    return {
      summary: `${plural(s.synthesisEmails.length, 'adresse')} — aucune cochée, les briefings ne partent nulle part`,
      status: 'warn',
    };
  }
  return {
    summary: `${s.synthesisEmailsActive.join(', ')} — ${s.synthesisEmailsActive.length} destinataire${s.synthesisEmailsActive.length > 1 ? 's' : ''} sur ${s.synthesisEmails.length}`,
    status: 'ok',
  };
}

export function senderSummary(s: SummarySource): SectionState {
  if (s.senderEmails.length === 0) {
    return { summary: 'Aucune adresse enregistrée', status: 'neutral' };
  }
  const main = s.senderEmail ?? s.senderEmails[0]!;
  const others = s.senderEmails.length - 1;
  return {
    summary: others > 0 ? `${main} (+${others} autre${others > 1 ? 's' : ''})` : main,
    status: 'ok',
  };
}

export function resendSummary(s: SummarySource): SectionState {
  return s.resendApiKeyConfigured
    ? { summary: 'Clé enregistrée', status: 'ok' }
    : {
        summary: 'Aucune clé — aucun mail candidat ne peut partir',
        status: 'warn',
      };
}

export function interviewSummary(s: SummarySource): SectionState {
  const link = s.interviewConfig.agendaLink.trim();
  const org = s.interviewConfig.organisationName.trim();
  const who = org || 'organisation non nommée';
  return link
    ? { summary: `${who} · lien d’agenda configuré`, status: 'ok' }
    : {
        summary: `${who} · aucun lien d’agenda (hors campagnes en réservation native)`,
        status: 'warn',
      };
}

export function brandingSummary(s: SummarySource): SectionState {
  const bits = [
    s.brandingConfig.logoUrl ? 'logo' : null,
    s.brandingConfig.accentColor ? 'couleur' : null,
  ].filter((b): b is string => b !== null);
  return bits.length === 0
    ? { summary: 'Apparence par défaut', status: 'neutral' }
    : { summary: `Personnalisée : ${bits.join(' + ')}`, status: 'ok' };
}

export function vivierSummary(s: SummarySource): SectionState {
  const auto = s.vivierConfig.contactMode === 'auto';
  return {
    summary: `Contact ${auto ? 'automatique' : 'après validation'} · cooldown ${s.vivierConfig.cooldownDays} j`,
    status: 'ok',
  };
}

/**
 * Résumé de la section « Canaux de diffusion ».
 *
 * Il porte l'état APEC, parce que c'est le seul canal réellement branché : un
 * « 0 configurée sur 4 » cacherait qu'il manque un code NAF, et on l'apprendrait
 * en butant sur un bouton désarmé au fond d'une campagne.
 */
export function channelsSummary(s: SummarySource, total: number): SectionState {
  const missing = missingAdepSettings(s.adepConfig);
  if (missing.length > 0) {
    return {
      summary: `APEC : il manque ${missing.join(', ')}`,
      status: 'warn',
    };
  }
  return {
    summary:
      s.channelsConfigured === 0
        ? 'APEC prêt — aucune autre intégration configurée'
        : `APEC prêt · ${s.channelsConfigured} autre${s.channelsConfigured > 1 ? 's' : ''} sur ${total}`,
    status: 'ok',
  };
}

export function integrationsSummary(configured: number, total: number): SectionState {
  return {
    summary:
      configured === 0
        ? 'Aucune intégration configurée'
        : `${configured} configurée${configured > 1 ? 's' : ''} sur ${total}`,
    status: 'neutral',
  };
}

/** Compte les signaux d'attention — affiché en tête de page. */
export function countWarnings(states: SectionState[]): number {
  return states.filter((s) => s.status === 'warn').length;
}
