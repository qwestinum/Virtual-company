import { ManagerChatLayout } from '@/components/chat/ManagerChatLayout';
import { HydrationGate } from '@/components/HydrationGate';
import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { WorkspaceChrome } from '@/components/workspace/WorkspaceChrome';

/**
 * Coque commune des cinq entrées du workspace Recrutement.
 *
 * Elle existe pour qu'un changement d'entrée soit une NAVIGATION et non un
 * changement d'état : bandeau, fil d'Ariane, barre des cinq entrées, chat
 * Manager et pied de page sont montés UNE fois par le layout, et seule la
 * zone centrale est remplacée. Sans ça, chaque page re-monterait le chat —
 * donc fermerait la conversation ouverte à chaque clic d'onglet.
 *
 * Le groupe de routes `(workspace)` ne paraît pas dans l'URL : les adresses
 * restent `/aujourdhui`, `/campagnes`, `/candidatures`, `/entretiens`,
 * `/pilotage`.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex h-[100svh] w-full flex-col overflow-hidden">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'RH', href: '/rh' },
          { label: 'Recrutement' },
        ]}
        showSettings={false}
      />
      <div className="relative flex min-h-0 w-full flex-1">
        <HydrationGate />
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceChrome>{children}</WorkspaceChrome>
        </section>
        <ManagerChatLayout />
      </div>
      <SiteFooter />
    </main>
  );
}
