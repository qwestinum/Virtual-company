/**
 * Garde d'authentification pour routes /api (défense en profondeur).
 *
 * Le gate PRINCIPAL est le proxy (`src/proxy.ts`), qui protège TOUTE route
 * `/api` par défaut (deny-by-default). Ce helper sert à revérifier la session
 * DANS une route particulièrement sensible (ex. génération de lien signé vers
 * un CV) — ceinture + bretelles.
 *
 * Lit la session EXACTEMENT comme le reste de l'app : `getAuthServerClient()`
 * (@supabase/ssr, mêmes cookies que le proxy `getUserFromMiddleware` et que
 * `/login` / `/auth/callback`). `auth.getUser()` revalide le JWT côté serveur.
 */
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';

import { getAuthServerClient } from '@/lib/auth/supabase-server';

/** Utilisateur authentifié, ou `null` si pas de session valide. */
export async function getApiUser(): Promise<User | null> {
  const supabase = await getAuthServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/** Réponse 401 JSON standard (jamais de redirect — c'est une API). */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
