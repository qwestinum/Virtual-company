/**
 * Connecteur d'agenda externe — les DEUX étages du flag, fail-closed.
 *
 *   1. Le DÉPLOIEMENT l'autorise (`isBusyCalendarEnabled` : variable + clé).
 *   2. Le CABINET l'allume (`app_settings.busy_calendar_config.enabled`).
 *
 * Tout doute ⇒ éteint : base injoignable, colonne absente, réglage illisible.
 *
 * L'étage cabinet est relu au plus toutes les 30 s par instance : il est
 * consulté sur le chemin d'une page candidat et d'une confirmation, et il
 * change quelques fois dans la vie d'une installation. La route des réglages
 * invalide la mémoire à l'enregistrement ; sur les AUTRES instances, un
 * changement met au plus 30 s à s'appliquer.
 */
import { getAppSettings } from '@/lib/db/repos/app-settings';

import { isBusyCalendarEnabled } from './flag';

export const CABINET_FLAG_TTL_MS = 30_000;

let memo: { value: boolean; at: number } | null = null;

export async function isBusyCalendarActive(
  deps: {
    env?: Record<string, string | undefined>;
    loadCabinetEnabled?: () => Promise<boolean>;
    now?: () => number;
  } = {},
): Promise<boolean> {
  if (!isBusyCalendarEnabled(deps.env)) return false;
  const now = (deps.now ?? Date.now)();
  if (!deps.loadCabinetEnabled && memo && now - memo.at < CABINET_FLAG_TTL_MS) return memo.value;
  let value = false;
  try {
    value = await (deps.loadCabinetEnabled ?? loadFromSettings)();
  } catch {
    value = false;
  }
  if (!deps.loadCabinetEnabled) memo = { value, at: now };
  return value;
}

async function loadFromSettings(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings?.busyCalendarConfig.enabled === true;
}

/** Force la relecture au prochain appel (enregistrement des réglages, tests). */
export function invalidateBusyCalendarActive(): void {
  memo = null;
}
