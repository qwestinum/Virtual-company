import Link from 'next/link';

import { Breadcrumb } from '@/components/navigation/Breadcrumb';
import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { SettingsHub } from '@/components/settings/SettingsHub';

export const metadata = {
  title: 'Paramètres — QWESTINUM',
};

/**
 * Hub de configuration (Session 7).
 *
 * Cinq sections : boîtes IMAP, synthèse, expéditeur, intégrations flux,
 * intégrations canaux. Background atelier commun ; navigation via
 * logo (retour Lobby) et breadcrumb (Lobby › Paramètres).
 */
export default function SettingsPage() {
  return (
    <main className="relative min-h-[100svh]">
      <WorkspaceBackground />
      <div className="relative mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center gap-4 mb-8 flex-wrap">
          <Link href="/" aria-label="Retour au Lobby">
            <OrqaLogo width={120} />
          </Link>
          <Breadcrumb
            items={[
              { label: '🏠 Lobby', href: '/' },
              { label: 'Paramètres' },
            ]}
          />
        </div>
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
    </main>
  );
}
