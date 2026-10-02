/**
 * Forme des réglages telle que le hub de /settings la reçoit de `/api/settings`,
 * partagée par les blocs extraits du hub.
 */
import type { AdepConfig } from '@/types/adep-settings';
import type { BrandingConfig } from '@/types/branding';
import type { InterviewConfig } from '@/types/interview-settings';
import type { SourcingConfig } from '@/types/sourcing-settings';
import type { VivierConfig } from '@/types/vivier-settings';

export type IntegrationConfig = {
  status: 'configured' | 'unconfigured';
  credential?: string;
  notes?: string;
};

export type SettingsData = {
  synthesisEmail: string | null;
  synthesisEmails: string[];
  /** Sous-ensemble coché = destinataires des briefings (choix multiple). */
  synthesisEmailsActive: string[];
  senderEmail: string | null;
  senderEmails: string[];
  intakeEmail: string | null;
  fluxConfig: Record<string, IntegrationConfig>;
  channelsConfig: Record<string, IntegrationConfig>;
  vivierConfig: VivierConfig;
  interviewConfig: InterviewConfig;
  /** Identité du cabinet (logo, couleur) — surfaces candidat. */
  brandingConfig: BrandingConfig;
  /** Réglages APEC du cabinet (code NAF, description, convention). */
  adepConfig: AdepConfig;
  /** Recherche de profils — second étage du flag (admin). */
  sourcingConfig: SourcingConfig;
  /** Clé Resend : statut seulement (la valeur n'est jamais renvoyée). */
  resendApiKeyConfigured: boolean;
  updatedAt: string;
};

export type SettingsFallbacks = {
  synthesisEmail: string | null;
  senderEmail: string | null;
};

/** Enregistre un sous-ensemble des réglages et affiche le message de retour. */
export type PatchAndSave = (patch: Partial<SettingsData>, flashMessage: string) => void;
