import { DashboardView } from '@/components/dashboard/DashboardView';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';

export const metadata = {
  title: 'Dashboard (admin) — QWESTINUM',
};

/**
 * Dashboard de pilotage interne (coût IA, usage agents, métriques) — sorti de
 * la navigation client (le menu Candidatures a repris la liste candidats). Route
 * NON listée, gatée par la session (`/admin` ∈ PROTECTED_PREFIXES). Sans système
 * de rôles aujourd'hui : « admin » = tout utilisateur authentifié connaissant
 * l'URL — dette documentée dans docs/BACKLOG.md (à durcir au multi-utilisateur).
 *
 * `DashboardView` est `position:absolute inset:0` → on lui fournit un ancêtre
 * `relative` à hauteur bornée (flex-1 dans un main pleine hauteur).
 */
export default function AdminDashboardPage() {
  return (
    <main className="relative flex h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'Dashboard (admin)' },
        ]}
      />
      <div className="relative flex-1 overflow-hidden">
        <DashboardView />
      </div>
    </main>
  );
}
