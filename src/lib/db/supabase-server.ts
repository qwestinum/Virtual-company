/**
 * Client Supabase côté serveur (Session 5, round 1).
 *
 * Utilise la `service_role_key` — elle ne doit JAMAIS être exposée au
 * navigateur. Tous les accès Supabase côté client passent par les
 * routes `/api/...` qui appellent ce client.
 *
 * Mode dégradé : si l'une des variables d'env manque, `getServerSupabase`
 * retourne null. Les API routes traduisent ça en réponse `503
 * supabase_not_configured` et le front continue en mode volatile (cf.
 * SESSION_5.md §2). On ne plante pas le boot d'une démo locale.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getServerSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    cached = null;
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'virtual-enterprise/session-5' } },
  });
  return cached;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('supabase_not_configured');
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function requireServerSupabase(): SupabaseClient {
  const client = getServerSupabase();
  if (!client) throw new SupabaseNotConfiguredError();
  return client;
}
