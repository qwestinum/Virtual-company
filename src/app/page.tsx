import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { ChatDock } from '@/components/chat/ChatDock';

export default function Home() {
  return (
    <main className="flex h-[100svh] w-full overflow-hidden">
      <section
        className="relative flex-1 min-w-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse at top, #fdfcf9 0%, #f3f1ec 70%, #ebe8e1 100%)',
        }}
      >
        <HRDepartmentView />
        <AgentDetailsPanel />
      </section>
      <ChatDock />
    </main>
  );
}
