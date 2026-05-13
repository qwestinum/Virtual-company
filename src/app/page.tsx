import { ManagerChatLayout } from '@/components/chat/ManagerChatLayout';
import { HydrationGate } from '@/components/HydrationGate';
import { WorkspacePane } from '@/components/workspace/WorkspacePane';

export default function Home() {
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
