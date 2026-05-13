'use client';

/**
 * Formulaire de login email/password.
 *
 * - Submit → `supabase.auth.signInWithPassword`, le cookie de session
 *   est posé automatiquement par @supabase/ssr (côté browser).
 * - Si succès : router.push(next) — par défaut `/app`.
 * - Erreur d'auth : message inline sous le champ, pas de toast bruyant.
 * - Bouton « Créer un compte » désactivé (MVP), tooltip explicatif.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { getAuthBrowserClient } from '@/lib/auth/supabase-browser';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = getAuthBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(
        authError.message === 'Invalid login credentials'
          ? 'Email ou mot de passe incorrect.'
          : authError.message,
      );
      setSubmitting(false);
      return;
    }
    // Force un refresh du Server Component pour que les cookies
    // fraîchement posés soient lus côté serveur dès la prochaine nav.
    router.refresh();
    router.push(nextPath);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="font-body text-[12.5px] font-semibold text-stone-700"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 font-body text-[14px] text-stone-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
          placeholder="prenom.nom@entreprise.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="password"
            className="font-body text-[12.5px] font-semibold text-stone-700"
          >
            Mot de passe
          </label>
          <Link
            href="/login/reset"
            className="font-body text-[11.5px] text-stone-500 hover:text-amber-700 hover:underline underline-offset-2"
          >
            Mot de passe oublié&nbsp;?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 font-body text-[14px] text-stone-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-[12.5px] text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !email || !password}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-display text-[14px] font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        style={{ background: 'linear-gradient(135deg, #FFB000, #FF8A00)' }}
      >
        {submitting ? 'Connexion…' : 'Se connecter'}
      </button>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-stone-200" />
        <span className="font-body text-[11px] uppercase tracking-[0.12em] text-stone-400">
          ou
        </span>
        <div className="h-px flex-1 bg-stone-200" />
      </div>

      <button
        type="button"
        disabled
        title="Bientôt disponible — contactez QWESTINUM pour la création de comptes."
        aria-disabled
        className="cursor-not-allowed rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 font-body text-[13px] font-semibold text-stone-400"
      >
        Créer un compte
      </button>
    </form>
  );
}
