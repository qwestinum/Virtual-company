/**
 * Ports injectés — la SEULE façon dont le module touche le monde extérieur.
 *
 * Le module n'importe rien de l'application hôte : il reçoit un client base,
 * un transport d'email, une horloge et l'URL publique. C'est ce qui le rend
 * extractible en package sans réécriture (et testable sans l'hôte).
 *
 * L'hôte appelle `configureScheduling(...)` une fois au démarrage. Tant qu'il
 * ne l'a pas fait, toute opération échoue avec un message explicite plutôt que
 * de tomber sur un `undefined` à dix appels de profondeur.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { SchedulingNotConfiguredError } from './errors';
import { FR_LABELS, type SchedulingLabels } from './labels';
import { DEFAULT_RATE_LIMITS, type RateLimitPolicy } from './rate-limit';

/** Transport d'email. Le module COMPOSE, l'hôte ACHEMINE. */
export type MailAttachment = {
  filename: string;
  /** Contenu encodé en base64 (le module ne présume pas du transport). */
  contentBase64: string;
  contentType?: string;
};

export type MailMessage = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
};

export type MailSendResult = {
  ok: boolean;
  messageId: string | null;
  error?: string;
};

export type MailPort = {
  send(message: MailMessage): Promise<MailSendResult>;
};

/**
 * Identité visuelle de l'INSTALLATION — pas d'un lien.
 *
 * Un logo et une couleur appartiennent à l'organisation qui exploite le
 * service, pas à un rendez-vous : les passer par lien voudrait dire les
 * répéter à chaque émission et pouvoir se contredire d'un envoi à l'autre.
 * Absents, les surfaces gardent leur apparence par défaut — le module reste
 * présentable sans configuration.
 */
export type SchedulingBranding = {
  /** URL absolue d'une image affichée en tête des pages et des messages. */
  logoUrl?: string | null;
  /** Couleur d'accent (toute valeur CSS valide) — boutons, sélection, liens. */
  accentColor?: string | null;
};

export type ResolvedBranding = {
  logoUrl: string | null;
  accentColor: string | null;
};

export type SchedulingConfig = {
  /** Client base. Une fonction permet une résolution paresseuse par requête. */
  supabase: SupabaseClient | (() => SupabaseClient);
  /** Absent ⇒ aucune notification n'est envoyée (le cœur reste utilisable). */
  mailer?: MailPort;
  /** Horloge injectable — les tests figent le temps sans toucher au global. */
  now?: () => Date;
  /** Racine des URLs publiques, ex. `https://app.exemple.fr`. */
  publicBaseUrl?: string;
  /** Préfixe de la page de réservation. */
  linkPathPrefix?: string;
  /** Préfixe de la page de gestion (annuler / replanifier). */
  managePathPrefix?: string;
  /**
   * Nom affiché dans les messages et les invitations d'agenda. À défaut, les
   * gabarits se contentent de ce que `display` fournit — le module n'invente
   * jamais un nom d'organisation.
   */
  organizationName?: string;
  /** Identité visuelle de l'installation (logo, couleur d'accent). */
  branding?: SchedulingBranding;
  /**
   * Le module prévient-il lui-même la personne qui REÇOIT le rendez-vous ?
   *
   * `true` par défaut — le module doit rester utilisable seul. Un hôte qui
   * envoie sa PROPRE notification (plus riche : dossier, pièces jointes) la
   * met à `false` : sans cela, la même personne reçoit deux messages pour un
   * seul fait, et le plus pauvre arrive le premier.
   *
   * Sans effet sur l'invité, qui est notifié dans tous les cas.
   */
  notifyOrganizer?: boolean;
  /** Surcharge de libellés — notamment la mention de traitement des données. */
  labels?: Partial<SchedulingLabels>;
  /** Budgets de débit des surfaces publiques. */
  rateLimits?: Partial<RateLimitPolicy>;
};

type ResolvedConfig = Required<
  Omit<
    SchedulingConfig,
    'mailer' | 'organizationName' | 'branding' | 'labels' | 'rateLimits'
  >
> & {
  mailer: MailPort | null;
  organizationName: string | null;
  branding: ResolvedBranding;
  notifyOrganizer: boolean;
  labels: SchedulingLabels;
  rateLimits: RateLimitPolicy;
};

let config: ResolvedConfig | null = null;

export function configureScheduling(input: SchedulingConfig): void {
  config = {
    supabase: input.supabase,
    mailer: input.mailer ?? null,
    now: input.now ?? (() => new Date()),
    publicBaseUrl: (input.publicBaseUrl ?? '').replace(/\/+$/, ''),
    linkPathPrefix: normalizePrefix(input.linkPathPrefix ?? '/r'),
    managePathPrefix: normalizePrefix(input.managePathPrefix ?? '/b'),
    organizationName: input.organizationName?.trim() || null,
    branding: {
      logoUrl: input.branding?.logoUrl?.trim() || null,
      accentColor: input.branding?.accentColor?.trim() || null,
    },
    notifyOrganizer: input.notifyOrganizer ?? true,
    labels: { ...FR_LABELS, ...(input.labels ?? {}) },
    rateLimits: {
      slots: { ...DEFAULT_RATE_LIMITS.slots, ...(input.rateLimits?.slots ?? {}) },
      book: { ...DEFAULT_RATE_LIMITS.book, ...(input.rateLimits?.book ?? {}) },
      manage: { ...DEFAULT_RATE_LIMITS.manage, ...(input.rateLimits?.manage ?? {}) },
    },
  };
}

/**
 * Rafraîchit UNIQUEMENT ce qui relève de la présentation : nom affiché,
 * identité visuelle, libellés. Les ports (base, transport, horloge) ne
 * bougent pas.
 *
 * Exister séparément de `configureScheduling` a une raison précise : ces
 * valeurs-là changent en cours de vie (l'hôte les relit périodiquement),
 * alors que les ports sont posés une fois. Tout re-passer par la
 * configuration complète obligerait l'hôte à re-fournir son transport à
 * chaque rafraîchissement — et un hôte qui en oublie un se retrouverait avec
 * un module muet sans rien avoir demandé.
 *
 * Sans configuration préalable : sans effet (rien à rafraîchir).
 */
export function updateSchedulingIdentity(input: {
  organizationName?: string | null;
  branding?: SchedulingBranding;
  labels?: Partial<SchedulingLabels>;
}): void {
  if (!config) return;
  if (input.organizationName !== undefined) {
    config.organizationName = input.organizationName?.trim() || null;
  }
  if (input.branding !== undefined) {
    config.branding = {
      logoUrl: input.branding.logoUrl?.trim() || null,
      accentColor: input.branding.accentColor?.trim() || null,
    };
  }
  if (input.labels !== undefined) {
    config.labels = { ...config.labels, ...input.labels };
  }
}

/** Remet le module à l'état non configuré (tests, démontage). */
export function resetSchedulingConfig(): void {
  config = null;
}

export function isSchedulingConfigured(): boolean {
  return config !== null;
}

function requireConfig(): ResolvedConfig {
  if (!config) throw new SchedulingNotConfiguredError();
  return config;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function db(): SupabaseClient {
  const { supabase } = requireConfig();
  return typeof supabase === 'function' ? supabase() : supabase;
}

/** null ⇒ pas de transport configuré : on ne notifie pas, on ne casse pas. */
export function mailer(): MailPort | null {
  return requireConfig().mailer;
}

export function now(): Date {
  return requireConfig().now();
}

export function nowIso(): string {
  return now().toISOString();
}

export function bookingUrl(token: string): string {
  const { publicBaseUrl, linkPathPrefix } = requireConfig();
  return `${publicBaseUrl}${linkPathPrefix}/${token}`;
}

export function manageUrl(manageToken: string): string {
  const { publicBaseUrl, managePathPrefix } = requireConfig();
  return `${publicBaseUrl}${managePathPrefix}/${manageToken}`;
}

/** Libellés effectifs (défauts du module + surcharges de l'hôte). */
export function labels(): SchedulingLabels {
  return requireConfig().labels;
}

export function rateLimits(): RateLimitPolicy {
  return requireConfig().rateLimits;
}

export function organizationName(): string | null {
  return requireConfig().organizationName;
}

/** Identité visuelle effective — jamais `undefined`, au pire deux `null`. */
export function branding(): ResolvedBranding {
  return requireConfig().branding;
}

/** false ⇒ l'hôte se charge lui-même de prévenir qui reçoit le rendez-vous. */
export function notifiesOrganizer(): boolean {
  return requireConfig().notifyOrganizer;
}

/**
 * Domaine des UID d'agenda — dérivé de l'URL publique, pour que deux
 * installations distinctes ne produisent jamais le même identifiant.
 */
export function icsDomain(): string {
  const { publicBaseUrl } = requireConfig();
  try {
    return new URL(publicBaseUrl).hostname || 'scheduling.invalid';
  } catch {
    return 'scheduling.invalid';
  }
}

/**
 * Transport de test : enregistre au lieu d'envoyer. Livré avec le module (le
 * module compose des messages minimaux, la mise en forme viendra ensuite).
 */
export function createRecordingMailer(): MailPort & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message: MailMessage): Promise<MailSendResult> {
      sent.push(message);
      return { ok: true, messageId: `recorded-${sent.length}` };
    },
  };
}
