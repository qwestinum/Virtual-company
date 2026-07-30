/**
 * Client Supabase « auth-aware » côté serveur (Server Components,
 * Route Handlers). Lit la session depuis les cookies posés par le
 * client browser ; écrit/rafraîchit les cookies quand Supabase
 * renvoie un nouveau jeton (rotation refresh-token).
 *
 * Convention Next App Router : on instancie un nouveau client par
 * requête (pas de singleton) parce que `cookies()` est lié au scope
 * de la requête courante.
 */

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getAuthServerClient(): Promise<SupabaseClient | null> {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
  } catch {
    // Hors scope de requête Next (handler invoqué in-process : tests de
    // régression, appels internes) : pas de cookies ⇒ pas de session
    // possible. `null` est le contrat existant « aucune session » — les
    // gardes (getApiUser/requireAdmin) restent FAIL-CLOSED (member/401),
    // jamais une exception qui fait planter une route par ailleurs saine.
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // En prod sur Vercel, mieux vaut retourner null que de jeter — le
    // Server Component appelant doit traiter ce cas (vérification de
    // session optionnelle). Une vraie protection vit dans le proxy.
    return null;
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        // En Server Component pur, l'écriture de cookies n'est pas
        // permise et lance une erreur silencieuse → on l'avale plutôt
        // que de faire planter la page. Le middleware est responsable
        // de rafraîchir la session (où l'écriture est autorisée).
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // no-op (cookies non writable en Server Component)
        }
      },
    },
  });
}
