/**
 * Helper d'auth pour le middleware Next.js.
 *
 * Différent de `supabase-server.ts` : ici, on écrit/lit les cookies via
 * `NextRequest` / `NextResponse`, pas via `next/headers`. C'est la
 * convention `@supabase/ssr` pour middleware.
 *
 * Retourne :
 *   - `response` : NextResponse à renvoyer (avec cookies de session
 *     éventuellement rafraîchis),
 *   - `user`     : l'utilisateur authentifié, ou `null`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

export async function getUserFromMiddleware(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { response, user: null };
  }

  try {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return { response, user };
  } catch {
    // Si Supabase est injoignable / mal configuré, on retourne null
    // plutôt que de jeter — sinon tout le site renvoie 500 (y compris
    // les routes publiques). Les routes protégées seront bouncées
    // vers /login, les publiques continueront de rendre normalement.
    return { response, user: null };
  }
}
