/**
 * Callback handler pour les liens emails Supabase Auth.
 *
 * Cas d'usage :
 *   - lien de réinitialisation de mot de passe (`resetPasswordForEmail`)
 *   - lien magique (si on l'active plus tard)
 *
 * Supabase redirige vers cette route avec un `code` query param après
 * que l'utilisateur a cliqué sur le lien dans son mail. On échange le
 * code contre une session, puis on redirige vers `next` (par défaut
 * `/app`).
 *
 * En cas d'échec : retour à `/login` avec un message d'erreur dans
 * la query string.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getAuthServerClient } from '@/lib/auth/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app';

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=missing_code`,
    );
  }

  const supabase = await getAuthServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }
  return NextResponse.redirect(`${origin}${next}`);
}
