import { ManagerChatLayout } from '@/components/chat/ManagerChatLayout';
import { HydrationGate } from '@/components/HydrationGate';
import { WorkspacePane } from '@/components/workspace/WorkspacePane';

export const metadata = {
  title: 'Recrutement — QWESTINUM',
};

/**
 * Service Recrutement — page MVP (Session 7).
 *
 * Le contenu historique du root (`/`) — workspace bureau + chat
 * manager — vit désormais ici. Le `/` racine héberge le Lobby
 * (Session 7). Le breadcrumb est posé par `WorkspacePane` au-dessus
 * de ses onglets pour rester visible à l'utilisateur quel que soit
 * l'onglet (Bureau ou Dashboard).
 */
export default function RecrutementPage() {
  return (
    <main className="relative flex h-[100svh] w-full overflow-hidden">
      <HydrationGate />
      <section
        className="relative flex-1 min-w-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse at top, #fdfcf9 0%, #f3f1ec 70%, #ebe8e1 100%)',
        }}
      >
        <WorkspacePane />
      </section>
      <ManagerChatLayout />
    </main>
  );
}
