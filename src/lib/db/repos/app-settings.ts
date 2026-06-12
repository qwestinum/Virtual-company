/**
 * Repo Supabase pour les settings applicatifs (Session 6 v4).
 *
 * Source de vérité pour les adresses email (synthèse, expéditeur,
 * intake) et la configuration des intégrations flux/canaux. Single-row
 * (`id = 1` garanti par le check côté SQL). Les helpers exposent un
 * shape « domain » plat, le mapping row↔domain reste local.
 *
 * Mode dégradé : `getAppSettings` renvoie `null` si Supabase n'est pas
 * configuré — les call sites retombent sur les variables d'env
 * historiques (EMAIL_DRH, EMAIL_FROM) pour ne pas casser un environnement
 * de démo local.
 */

import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import { DEFAULT_HITL_CONFIG, type HitlConfig } from '@/types/hitl';
import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG, type VivierConfig } from '@/types/vivier-settings';

const TABLE = 'app_settings';

export type IntegrationStatus = 'configured' | 'unconfigured';

export type AppSettings = {
  /** Adresse par défaut utilisée par le pipeline. */
  synthesisEmail: string | null;
  /** Toutes les adresses de synthèse enregistrées par le DRH. */
  synthesisEmails: string[];
  /** Adresse expéditeur par défaut. */
  senderEmail: string | null;
  /** Toutes les adresses expéditeurs enregistrées. */
  senderEmails: string[];
  intakeEmail: string | null;
  fluxConfig: Record<string, IntegrationConfig>;
  channelsConfig: Record<string, IntegrationConfig>;
  /** Toggles HITL par section (validation humaine des mails). Défaut ON. */
  hitlConfig: HitlConfig;
  /** Réglages vivier (mode contact, template invitation, cooldown, plafond). */
  vivierConfig: VivierConfig;
  /** Réglages entretien (templates acceptation/refus, lien d'agenda org-level). */
  interviewConfig: InterviewConfig;
  updatedAt: string;
};

export type IntegrationConfig = {
  status: IntegrationStatus;
  /** Identifiant API / clé / token (en clair pour le MVP démo). */
  credential?: string;
  /** Notes libres saisies par le DRH. */
  notes?: string;
};

type AppSettingsRow = {
  id: number;
  synthesis_email: string | null;
  synthesis_emails: string[] | null;
  sender_email: string | null;
  sender_emails: string[] | null;
  intake_email: string | null;
  flux_config: Record<string, IntegrationConfig>;
  channels_config: Record<string, IntegrationConfig>;
  hitl_config: HitlConfig | null;
  vivier_config: VivierConfig | null;
  interview_config: InterviewConfig | null;
  updated_at: string;
};

/**
 * Fusionne une adresse singulière legacy dans une liste — sans
 * dupliquer si déjà présente. Permet de combler des rows où la table
 * a été créée AVANT la migration v6 mais dont la valeur singulière
 * existait déjà (ex. EMAIL_FROM importé, ou saisie via une version
 * antérieure de l'UI).
 */
function mergeLegacy(list: string[] | null, legacy: string | null): string[] {
  const out = Array.isArray(list) ? [...list] : [];
  if (legacy && !out.includes(legacy)) {
    out.unshift(legacy);
  }
  return out;
}

function rowToDomain(row: AppSettingsRow): AppSettings {
  return {
    synthesisEmail: row.synthesis_email,
    synthesisEmails: mergeLegacy(row.synthesis_emails, row.synthesis_email),
    senderEmail: row.sender_email,
    senderEmails: mergeLegacy(row.sender_emails, row.sender_email),
    intakeEmail: row.intake_email,
    fluxConfig: row.flux_config ?? {},
    channelsConfig: row.channels_config ?? {},
    hitlConfig: row.hitl_config ?? DEFAULT_HITL_CONFIG,
    // Fusion avec les défauts : tolère une row antérieure à la migration V3
    // (vivier_config absent) ou un jsonb partiel.
    vivierConfig: { ...DEFAULT_VIVIER_CONFIG, ...(row.vivier_config ?? {}) },
    // Idem : fusion avec les défauts pour une row antérieure (interview_config
    // absent) ou un jsonb partiel.
    interviewConfig: {
      ...DEFAULT_INTERVIEW_CONFIG,
      ...(row.interview_config ?? {}),
    },
    updatedAt: row.updated_at,
  };
}

/**
 * Détecte les erreurs Postgres « table absente » (PostgREST PGRST205
 * ou code SQL 42P01). Quand la migration de la Session 6 v4 n'a pas
 * encore été passée, on dégrade en mode offline plutôt que d'échouer
 * en 500.
 */
function isTableMissing(err: { code?: string; message?: string }): boolean {
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('relation') &&
    msg.includes('app_settings') &&
    msg.includes('does not exist')
  );
}

export async function getAppSettings(): Promise<AppSettings | null> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(`getAppSettings: ${error.message}`);
    }
    if (!data) {
      // La ligne devrait être seedée par la migration ; si elle manque
      // on la crée silencieusement pour ne pas planter un environnement
      // fraîchement migré.
      const { data: inserted, error: insertErr } = await supabase
        .from(TABLE)
        .insert({ id: 1 })
        .select('*')
        .single();
      if (insertErr) {
        if (isTableMissing(insertErr)) return null;
        throw new Error(`getAppSettings (seed): ${insertErr.message}`);
      }
      return rowToDomain(inserted as AppSettingsRow);
    }
    return rowToDomain(data as AppSettingsRow);
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export type AppSettingsPatch = {
  synthesisEmail?: string | null;
  synthesisEmails?: string[];
  senderEmail?: string | null;
  senderEmails?: string[];
  intakeEmail?: string | null;
  fluxConfig?: Record<string, IntegrationConfig>;
  channelsConfig?: Record<string, IntegrationConfig>;
  hitlConfig?: HitlConfig;
  vivierConfig?: VivierConfig;
  interviewConfig?: InterviewConfig;
};

export async function patchAppSettings(
  patch: AppSettingsPatch,
): Promise<AppSettings> {
  const supabase = requireServerSupabase();
  const row: Partial<AppSettingsRow> = {};
  if (patch.synthesisEmail !== undefined)
    row.synthesis_email = patch.synthesisEmail;
  if (patch.synthesisEmails !== undefined)
    row.synthesis_emails = patch.synthesisEmails;
  if (patch.senderEmail !== undefined) row.sender_email = patch.senderEmail;
  if (patch.senderEmails !== undefined)
    row.sender_emails = patch.senderEmails;
  if (patch.intakeEmail !== undefined) row.intake_email = patch.intakeEmail;
  if (patch.fluxConfig !== undefined) row.flux_config = patch.fluxConfig;
  if (patch.channelsConfig !== undefined)
    row.channels_config = patch.channelsConfig;
  if (patch.hitlConfig !== undefined) row.hitl_config = patch.hitlConfig;
  if (patch.vivierConfig !== undefined) row.vivier_config = patch.vivierConfig;
  if (patch.interviewConfig !== undefined)
    row.interview_config = patch.interviewConfig;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw new Error(`patchAppSettings: ${error.message}`);
  return rowToDomain(data as AppSettingsRow);
}
