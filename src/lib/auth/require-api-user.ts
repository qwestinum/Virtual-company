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

/** Réponse 403 JSON standard (session valide mais rôle insuffisant). */
export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

// Cache mémoire COURT du rôle (le dashboard admin polle /api/metrics/global
// toutes les 5 s — pas un lookup DB par tick). Par processus : une
// promotion/révocation de rôle est effective sous 60 s, acceptable.
const ROLE_CACHE_TTL_MS = 60_000;
const roleCache = new Map<string, { role: 'admin' | 'member' | null; at: number }>();

/**
 * Utilisateur ADMIN authentifié, ou `null` (pas de session, pas de ligne
 * `recruiters`, désactivé, ou rôle member). FAIL-CLOSED à chaque étage : en
 * cas de doute, jamais admin. L'appelant répond `unauthorizedResponse()` si
 * aucune session, `forbiddenResponse()` sinon.
 */
async function roleFor(user: User): Promise<'admin' | 'member' | null> {
  const cached = roleCache.get(user.id);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.role;
  const { getRecruiterRole } = await import('@/lib/db/repos/recruiters');
  const role = await getRecruiterRole(user.id);
  roleCache.set(user.id, { role, at: Date.now() });
  return role;
}

export async function getAdminApiUser(): Promise<User | null> {
  const user = await getApiUser();
  if (!user) return null;
  return (await roleFor(user)) === 'admin' ? user : null;
}

/**
 * Garde complète d'une route ADMIN : rend la réponse d'erreur à retourner
 * (401 sans session, 403 sinon) ou `null` si l'accès est autorisé.
 */
export async function requireAdminApiUser(): Promise<NextResponse | null> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  return (await roleFor(user)) === 'admin' ? null : forbiddenResponse();
}

/** Purge du cache de rôle (tests). */
export function _resetRoleCacheForTests(): void {
  roleCache.clear();
}
