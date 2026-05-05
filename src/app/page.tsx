import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { OfficeScene } from '@/components/office/OfficeScene';

export default function Home() {
  return (
    <main className="relative h-[100svh] w-full overflow-hidden bg-zinc-200">
      <OfficeScene />
      <AgentDetailsPanel />
    </main>
  );
}
