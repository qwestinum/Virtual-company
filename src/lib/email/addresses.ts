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

import {
  getAppSettings,
  getResendApiKeyFromSettings,
} from '@/lib/db/repos/app-settings';

type Cache = {
  synthesis: string | null;
  synthesisList: string[];
  sender: string | null;
  resendApiKey: string | null;
  expiresAt: number;
};

let cached: Cache | null = null;
const TTL_MS = 60_000;

async function loadOnce(): Promise<Cache> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  let synthesisDb: string | null = null;
  let synthesisListDb: string[] = [];
  let senderDb: string | null = null;
  let resendKeyDb: string | null = null;
  try {
    const settings = await getAppSettings();
    if (settings) {
      synthesisDb = settings.synthesisEmail;
      synthesisListDb = settings.synthesisEmails;
      senderDb = settings.senderEmail;
    }
    // Lecture dédiée (la clé brute n'est PAS dans l'objet settings — write-only).
    resendKeyDb = await getResendApiKeyFromSettings();
  } catch {
    // En cas d'erreur DB, on tombe sur les env vars.
  }
  const synthesis = synthesisDb ?? process.env.EMAIL_DRH ?? null;
  // Liste effective : celle des settings, sinon repli sur la valeur singulière.
  const synthesisList =
    synthesisListDb.length > 0
      ? synthesisListDb
      : synthesis
        ? [synthesis]
        : [];
  cached = {
    synthesis,
    synthesisList,
    sender: senderDb ?? process.env.EMAIL_FROM ?? null,
    resendApiKey: resendKeyDb ?? process.env.RESEND_API_KEY ?? null,
    expiresAt: Date.now() + TTL_MS,
  };
  return cached;
}

export async function getSynthesisEmail(): Promise<string | null> {
  return (await loadOnce()).synthesis;
}

/**
 * TOUTES les adresses de synthèse configurées (Paramètres → « Adresses de
 * synthèse »). Repli sur la valeur singulière puis `EMAIL_DRH`. Destinataires
 * du briefing d'entretien délivré à la réservation Cal.com.
 */
export async function getSynthesisEmails(): Promise<string[]> {
  return (await loadOnce()).synthesisList;
}

export async function getSenderEmail(): Promise<string | null> {
  return (await loadOnce()).sender;
}

/**
 * Clé API Resend effective (settings DB en priorité, repli env). Lue côté
 * serveur uniquement par le client email. Cache 60s comme les adresses.
 */
export async function getResendApiKey(): Promise<string | null> {
  return (await loadOnce()).resendApiKey;
}

/**
 * Invalide le cache — appelé par /api/settings PUT pour que la prochaine
 * lecture remonte la nouvelle valeur sans attendre les 60s.
 */
export function invalidateEmailAddressesCache(): void {
  cached = null;
}
