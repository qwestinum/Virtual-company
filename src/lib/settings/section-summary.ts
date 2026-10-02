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
import {
  MISSING_ORGANISATION_NAME,
  missingAdepSettings,
  type AdepConfig,
} from '@/types/adep-settings';
import type { BrandingConfig } from '@/types/branding';
import type { InterviewConfig } from '@/types/interview-settings';
import type { VivierConfig } from '@/types/vivier-settings';

export type SectionState = {
  summary: string;
  status: SectionStatus;
  /**
   * Quand `status === 'warn'` : CE QUI MANQUE, nommé, et ce que ça casse.
   * Lu dans la liste en tête de page — « 2 réglages à compléter » sans dire
   * lesquels obligeait à tout déplier pour trouver le badge.
   */
  missing?: string;
};

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
    return {
      summary: 'Aucune adresse enregistrée',
      status: 'warn',
      missing: 'Aucune adresse de synthèse : les briefings d’entretien ne partent à personne',
    };
  }
  if (s.synthesisEmailsActive.length === 0) {
    return {
      summary: `${plural(s.synthesisEmails.length, 'adresse')} — aucune cochée, les briefings ne partent nulle part`,
      status: 'warn',
      missing: 'Aucune adresse de synthèse cochée : les briefings d’entretien ne partent à personne',
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
        missing: 'Clé d’envoi des mails (Resend) absente : aucun mail candidat ne peut partir',
      };
}

export function interviewSummary(s: SummarySource): SectionState {
  return s.interviewConfig.agendaLink.trim()
    ? { summary: 'Agenda interne · lien d’agenda externe configuré', status: 'ok' }
    : {
        summary: 'Agenda interne · aucun lien d’agenda externe (hors campagnes en réservation native)',
        status: 'warn',
        missing:
          'Lien d’agenda externe absent : les invitations des campagnes encore sur Cal.com sont bloquées',
      };
}

/**
 * Identité du cabinet : le NOM d'abord (il est repris dans chaque message au
 * candidat), puis l'apparence. Le nom vit dans cette section depuis le
 * 02/10/2026 ; il était avant avec l'agenda.
 *
 * Nom ABSENT ⇒ `warn` : l'Apec refuse l'offre (c'est son « enseigne »), et les
 * messages au candidat signent d'un nom générique. L'alerte vit ICI, là où se
 * fait la correction — « Y aller » doit mener au champ, pas aux intégrations.
 */
export function brandingSummary(s: SummarySource): SectionState {
  const name = s.interviewConfig.organisationName.trim();
  const bits = [
    s.brandingConfig.logoUrl ? 'logo' : null,
    s.brandingConfig.accentColor ? 'couleur' : null,
  ].filter((b): b is string => b !== null);
  const look = bits.length === 0 ? 'apparence par défaut' : `personnalisée : ${bits.join(' + ')}`;
  if (!name) {
    return {
      summary: `Nom de l’organisation non renseigné · ${look}`,
      status: 'warn',
      missing:
        'Nom de l’organisation absent : l’Apec refuse la publication (c’est l’enseigne de l’annonce) et les messages au candidat signent d’un nom générique',
    };
  }
  return bits.length === 0
    ? { summary: `${name} · ${look}`, status: 'neutral' }
    : { summary: `${name} · ${look}`, status: 'ok' };
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
  const all = missingAdepSettings(s.adepConfig, s.interviewConfig.organisationName);
  // Le nom de l'organisation est signalé par « Identité du cabinet », où il se
  // corrige : le compter ici ferait DEUX alertes pour un seul geste, dont une
  // qui mène au mauvais endroit.
  const missing = all.filter((m) => m !== MISSING_ORGANISATION_NAME);
  if (missing.length === 0 && all.length > 0) {
    return {
      summary: 'APEC : en attente du nom de l’organisation (Identité du cabinet)',
      status: 'neutral',
    };
  }
  if (missing.length > 0) {
    return {
      summary: `APEC : il manque ${missing.join(', ')}`,
      status: 'warn',
      missing: `Réglages APEC incomplets (${missing.join(', ')}) : publication sur l’APEC impossible`,
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

export type MissingSetting = {
  sectionId: string;
  sectionTitle: string;
  familyLabel: string;
  message: string;
};

/**
 * Les réglages manquants, NOMMÉS et SITUÉS (famille › section), dans l'ordre
 * de la page.
 *
 * ⚠️ Même source que les badges « à configurer » : une section en `warn`
 * figure ici, une section absente d'ici n'a pas de badge. Deux listes tenues
 * à part finiraient par dire deux choses différentes.
 * Une section en `warn` que ce profil ne voit pas (réservée admin) est
 * omise : on n'envoie personne vers une porte qui n'existe pas pour lui.
 */
export function listMissingSettings(
  states: Record<string, SectionState>,
  families: { label: string; sections: { id: string; title: string }[] }[],
): MissingSetting[] {
  const out: MissingSetting[] = [];
  for (const family of families) {
    for (const section of family.sections) {
      const state = states[section.id];
      if (state?.status !== 'warn') continue;
      out.push({
        sectionId: section.id,
        sectionTitle: section.title,
        familyLabel: family.label,
        message: state.missing ?? state.summary,
      });
    }
  }
  return out;
}
