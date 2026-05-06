import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { ManagerChat } from '@/components/chat/ManagerChat';

export default function Home() {
  return (
    <main className="flex h-[100svh] w-full overflow-hidden min-w-[1280px]">
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
      <aside
        className="h-full shrink-0 border-l border-stone-200 bg-stone-50/70 backdrop-blur-sm"
        style={{ width: 'min(50%, 720px)' }}
      >
        <ManagerChat />
      </aside>
    </main>
  );
}
