/**
 * Identité du cabinet — ce qui habille les surfaces vues par le candidat
 * (pages de réservation, messages du module d'entretien).
 *
 * Porté par AppSettings (colonne jsonb `branding_config`). Ne contient
 * DÉLIBÉRÉMENT pas le nom d'organisation : celui-ci existe déjà dans
 * `interviewConfig.organisationName` (la voix qui s'adresse au candidat) et
 * en poser une seconde copie créerait deux vérités à maintenir. Le nom se
 * résout par `resolveOrganizationName`, ici même, pour que tous les lecteurs
 * appliquent la même cascade.
 */
import { z } from 'zod';

export const BrandingConfigSchema = z.object({
  /** URL absolue du logo (upload ou lien externe). Vide = pas de logo. */
  logoUrl: z.string().max(2048).nullable(),
  /** Couleur d'accent CSS (`#0f766e`, `rgb(...)`). Vide = palette par défaut. */
  accentColor: z.string().max(64).nullable(),
});

export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;

export const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  logoUrl: null,
  accentColor: null,
};

/**
 * Forme MINIMALE attendue — structurelle exprès : ce module ne doit pas
 * importer le repo des réglages (qui, lui, l'importe).
 */
type OrganizationNameSource = {
  interviewConfig?: { organisationName?: string | null } | null;
  vivierConfig?: { organisationName?: string | null } | null;
} | null;

/**
 * Nom d'organisation effectif, dans l'ordre : réglage entretien (canonique,
 * c'est la signature des messages candidat) → réglage vivier (historique) →
 * variable d'environnement → `null` (on n'invente jamais un nom).
 */
export function resolveOrganizationName(
  settings: OrganizationNameSource,
): string | null {
  return (
    settings?.interviewConfig?.organisationName?.trim() ||
    settings?.vivierConfig?.organisationName?.trim() ||
    process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() ||
    null
  );
}
