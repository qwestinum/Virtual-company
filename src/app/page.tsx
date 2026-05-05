import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';

export default function Home() {
  return (
    <main
      className="relative h-[100svh] w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at top, #fdfcf9 0%, #f3f1ec 70%, #ebe8e1 100%)',
      }}
    >
      <HRDepartmentView />
      <AgentDetailsPanel />
    </main>
  );
}
