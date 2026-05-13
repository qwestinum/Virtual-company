import { ManagerChatLayout } from '@/components/chat/ManagerChatLayout';
import { HydrationGate } from '@/components/HydrationGate';
import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { WorkspacePane } from '@/components/workspace/WorkspacePane';

export const metadata = {
  title: 'Recrutement — QWESTINUM',
};

/**
 * Service Recrutement — page MVP.
 *
 * Bandeau ORQA + fond atelier commun à toutes les pages applicatives.
 * Le breadcrumb est porté par `TopBanner` ; le `WorkspacePane` ne
 * duplique plus son propre fil d'Ariane.
 */
export default function RecrutementPage() {
  return (
    <main className="relative flex flex-col h-[100svh] w-full overflow-hidden">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'RH', href: '/rh' },
          { label: 'Recrutement' },
        ]}
      />
      <div className="relative flex flex-1 min-h-0 w-full">
        <HydrationGate />
        <section className="relative flex-1 min-w-0 overflow-hidden">
          <WorkspacePane />
        </section>
        <ManagerChatLayout />
      </div>
      <SiteFooter />
    </main>
  );
}
