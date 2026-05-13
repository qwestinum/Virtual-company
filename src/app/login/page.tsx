import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/LoginForm';
import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { SiteFooter } from '@/components/navigation/SiteFooter';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { getAuthServerClient } from '@/lib/auth/supabase-server';

export const metadata = {
  title: 'Connexion — QWESTINUM',
};

/**
 * Page de login.
 *
 * Server Component : si l'utilisateur a déjà une session active, on
 * redirige vers `/app` directement (pas besoin de re-logger). Sinon,
 * on rend la card centrée avec le formulaire client.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await getAuthServerClient();
  const params = await searchParams;
  if (supabase) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        redirect(params.next ?? '/app');
      }
    } catch {
      // Supabase injoignable → on rend juste la page de login,
      // le user pourra tenter de se logger ; le formulaire affichera
      // l'erreur côté client si la requête échoue aussi.
    }
  }

  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 mb-7">
            <OrqaLogo width={150} priority />
            <div className="text-center">
              <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
                Entreprise virtuelle
              </p>
              <h1 className="font-display text-[22px] font-bold tracking-tight text-stone-900 leading-tight mt-1">
                Bienvenue
              </h1>
              <p className="font-body text-[13px] text-stone-600 mt-1.5 leading-relaxed">
                Connectez-vous pour accéder à votre cockpit RH.
              </p>
            </div>
          </div>

          <div
            className="rounded-2xl border border-amber-200 bg-white/85 p-6 shadow-[0_4px_18px_rgba(255,176,0,0.12)]"
            style={{ backdropFilter: 'blur(6px)' }}
          >
            <LoginForm />
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
