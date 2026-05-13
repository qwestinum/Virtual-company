'use client';

/**
 * Formulaire « Mot de passe oublié ».
 *
 * Étape 1 — l'utilisateur saisit son email, on appelle
 * `resetPasswordForEmail` avec un `redirectTo` qui pointe sur la
 * route handler `/auth/callback` (qui finalisera la session quand
 * l'utilisateur cliquera sur le lien email).
 *
 * Étape 2 — on affiche une confirmation discrète « Email envoyé »
 * sans fuiter si l'email existe vraiment (évite l'énumération).
 */

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { getAuthBrowserClient } from '@/lib/auth/supabase-browser';

export function PasswordResetForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = getAuthBrowserClient();
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const { error: authError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${origin}/auth/callback?next=/app` },
    );
    if (authError) {
      setError(authError.message);
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 font-body text-[12.5px] text-emerald-800">
          Si un compte est associé à cette adresse, un email contenant un
          lien de réinitialisation vient d&apos;être envoyé. Pensez à
          vérifier vos spams.
        </div>
        <Link
          href="/login"
          className="text-center font-body text-[12.5px] text-stone-600 hover:text-amber-700 underline-offset-2 hover:underline"
        >
          ← Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="reset-email"
          className="font-body text-[12.5px] font-semibold text-stone-700"
        >
          Email
        </label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 font-body text-[14px] text-stone-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
          placeholder="prenom.nom@entreprise.com"
        />
        <p className="font-body text-[11.5px] text-stone-500">
          Nous vous enverrons un lien pour définir un nouveau mot de passe.
        </p>
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
        disabled={submitting || !email}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-display text-[14px] font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        style={{ background: 'linear-gradient(135deg, #FFB000, #FF8A00)' }}
      >
        {submitting ? 'Envoi…' : 'Envoyer le lien'}
      </button>

      <Link
        href="/login"
        className="text-center font-body text-[12.5px] text-stone-500 hover:text-amber-700 underline-offset-2 hover:underline"
      >
        ← Retour à la connexion
      </Link>
    </form>
  );
}
