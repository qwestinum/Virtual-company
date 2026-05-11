/**
 * Client Supabase côté navigateur (Session 5, round 1).
 *
 * **Non utilisé en round 1** — toutes les opérations de persistance
 * passent par les routes `/api/...` (qui détiennent la service_role).
 * Ce fichier existe pour préparer une éventuelle écoute Realtime
 * (Session 7) et pour exposer une API uniforme côté client si on
 * relâche RLS plus tard.
 *
 * Mode dégradé : retourne null si les variables publiques manquent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    cached = null;
    return null;
  }

  cached = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
