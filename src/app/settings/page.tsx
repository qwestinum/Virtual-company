import Link from 'next/link';

import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { SettingsHub } from '@/components/settings/SettingsHub';

export const metadata = {
  title: 'Paramètres — QWESTINUM',
};

/**
 * Hub de configuration.
 *
 * Cinq sections : boîtes IMAP, synthèse, expéditeur, intégrations flux,
 * intégrations canaux. Bandeau ORQA + fond atelier commun à toutes les
 * pages applicatives.
 */
export default function SettingsPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'Paramètres' },
        ]}
      />
      <div className="relative mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Link
          href="/rh/recrutement"
          className="mb-6 inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-600 transition-colors hover:text-stone-900"
        >
          <span aria-hidden>←</span> Retour au recrutement
        </Link>
        <header className="mb-8">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Configuration
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Paramètres
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-2 max-w-2xl">
            Adresses email, flux d&apos;arrivée et canaux de diffusion. Les
            modifications sont appliquées au pipeline live dès la sauvegarde.
          </p>
        </header>
        <SettingsHub />
      </div>
      <SiteFooter />
    </main>
  );
}
