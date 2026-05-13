'use client';

/**
 * Client Supabase « auth-aware » côté navigateur.
 *
 * Différent du client data layer (`src/lib/db/supabase-browser.ts`) :
 * - ici, on utilise `@supabase/ssr` pour partager les cookies de
 *   session avec le serveur (middleware + Server Components),
 * - là-bas, c'est un simple anon client pour les lectures publiques.
 *
 * Singleton — la création d'un nouveau client à chaque appel romprait
 * le partage de session entre composants client (login, logout, header).
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getAuthBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes',
    );
  }
  cached = createBrowserClient(url, anon);
  return cached;
}
