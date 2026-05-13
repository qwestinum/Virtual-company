/**
 * Lookup des adresses email pilotées par les settings applicatifs
 * (Session 6 v4).
 *
 * Priorité de résolution :
 *   1. Valeur stockée dans `app_settings` (Supabase) si présente.
 *   2. Variable d'env historique (`EMAIL_DRH`, `EMAIL_FROM`).
 *
 * Cache 60s pour éviter de cogner la DB à chaque envoi de mail dans
 * une rafale. La modification depuis /settings se voit donc à la
 * minute suivante au pire — acceptable pour un MVP démo.
 */

import { getAppSettings } from '@/lib/db/repos/app-settings';

type Cache = {
  synthesis: string | null;
  sender: string | null;
  expiresAt: number;
};

let cached: Cache | null = null;
const TTL_MS = 60_000;

async function loadOnce(): Promise<Cache> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  let synthesisDb: string | null = null;
  let senderDb: string | null = null;
  try {
    const settings = await getAppSettings();
    if (settings) {
      synthesisDb = settings.synthesisEmail;
      senderDb = settings.senderEmail;
    }
  } catch {
    // En cas d'erreur DB, on tombe sur les env vars.
  }
  cached = {
    synthesis: synthesisDb ?? process.env.EMAIL_DRH ?? null,
    sender: senderDb ?? process.env.EMAIL_FROM ?? null,
    expiresAt: Date.now() + TTL_MS,
  };
  return cached;
}

export async function getSynthesisEmail(): Promise<string | null> {
  return (await loadOnce()).synthesis;
}

export async function getSenderEmail(): Promise<string | null> {
  return (await loadOnce()).sender;
}

/**
 * Invalide le cache — appelé par /api/settings PUT pour que la prochaine
 * lecture remonte la nouvelle valeur sans attendre les 60s.
 */
export function invalidateEmailAddressesCache(): void {
  cached = null;
}
