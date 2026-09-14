/**
 * Flag du module Sourcing — DEUX étages, FAIL-CLOSED (docs/specs/sourcing.md §13).
 *
 *   1. Le DÉPLOIEMENT l'autorise : `SOURCING_ENABLED === '1'` (strict, comme le
 *      jobboard de démonstration) ET `EXA_API_KEY` ET `SOURCING_FINGERPRINT_PEPPER`.
 *      Sans clé, aucune recherche ; sans sel, aucune empreinte — donc aucun
 *      dédoublonnage ni opposition possibles : le module n'a pas le droit
 *      d'exister à moitié.
 *   2. Le CABINET l'allume : `app_settings.sourcing_config.enabled === true`.
 *
 * Tout doute ⇒ éteint : une base injoignable, une colonne absente, une
 * variable vide. Éteint ⇒ onglet absent et routes en 404 (jamais 403, qui
 * confirmerait la surface).
 *
 * Pas de `NEXT_PUBLIC_*` : le client apprend l'état par le rendu serveur de la
 * page et par les 404 des routes.
 */
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { SOURCING_PEPPER_ENV } from '@/lib/sourcing/fingerprint';

const filled = (v: string | undefined): boolean => (v ?? '').trim().length > 0;

/** Étage 1 — pur, lit l'environnement fourni. */
export function isSourcingDeploymentEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    (env.SOURCING_ENABLED ?? '').trim() === '1' &&
    filled(env.EXA_API_KEY) &&
    filled(env[SOURCING_PEPPER_ENV])
  );
}

/** Étages 1 et 2. Ne lève jamais : toute erreur rend `false`. */
export async function isSourcingEnabled(
  /** Réglages déjà demandés par l'appelant (évite une seconde lecture). */
  preloadedSettings?: Promise<Awaited<ReturnType<typeof getAppSettings>>>,
): Promise<boolean> {
  if (!isSourcingDeploymentEnabled()) return false;
  try {
    const settings = await (preloadedSettings ?? getAppSettings());
    return settings?.sourcingConfig.enabled === true;
  } catch {
    return false;
  }
}
