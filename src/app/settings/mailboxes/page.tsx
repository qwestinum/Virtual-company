import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { MailboxesManager } from '@/components/settings/MailboxesManager';

export const metadata = {
  title: 'Boîtes mail — QWESTINUM',
};

/**
 * Page de configuration des boîtes mail IMAP surveillées par le poller.
 * Server component minimaliste — la logique vit dans
 * `<MailboxesManager />`.
 */
export default function MailboxesSettingsPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/' },
          { label: 'Paramètres', href: '/settings' },
          { label: 'Boîtes mail' },
        ]}
      />
      <div className="relative mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <header className="mb-8">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Configuration
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Boîtes mail
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-2 max-w-2xl">
            Ajoute des boîtes mail à surveiller pour la réception
            automatique des CVs. Quand un email arrive avec l&apos;ID de
            campagne dans l&apos;objet et un CV en pièce jointe, l&apos;agent
            CV Analyzer s&apos;exécute automatiquement.
          </p>
        </header>
        <MailboxesManager />
      </div>
      <SiteFooter />
    </main>
  );
}
