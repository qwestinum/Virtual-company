import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { SiteFooter } from '@/components/navigation/SiteFooter';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';

export const metadata = {
  title: 'Mot de passe oublié — QWESTINUM',
};

export default function PasswordResetPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 mb-7">
            <OrqaLogo width={150} priority />
            <div className="text-center">
              <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
                Réinitialisation
              </p>
              <h1 className="font-display text-[22px] font-bold tracking-tight text-stone-900 leading-tight mt-1">
                Mot de passe oublié&nbsp;?
              </h1>
            </div>
          </div>

          <div
            className="rounded-2xl border border-amber-200 bg-white/85 p-6 shadow-[0_4px_18px_rgba(255,176,0,0.12)]"
            style={{ backdropFilter: 'blur(6px)' }}
          >
            <PasswordResetForm />
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
