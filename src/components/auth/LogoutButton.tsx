'use client';

/**
 * Bouton « Se déconnecter » du bandeau supérieur.
 *
 * Appelle `supabase.auth.signOut()` qui invalide le cookie de session
 * côté serveur, puis `router.refresh()` pour re-render les Server
 * Components avec la nouvelle absence de session, et `router.push('/')`
 * pour revenir à la landing publique.
 */

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getAuthBrowserClient } from '@/lib/auth/supabase-browser';
import { cn } from '@/lib/utils';

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    const supabase = getAuthBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting}
      aria-label="Se déconnecter"
      title="Se déconnecter"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
        'font-body text-[11.5px] font-semibold text-stone-900/85',
        'bg-white/40 hover:bg-white/70 transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Se déconnecter</span>
    </button>
  );
}
