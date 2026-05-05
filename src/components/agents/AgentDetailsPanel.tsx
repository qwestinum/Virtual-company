'use client';

import { X } from 'lucide-react';

import { getAvatarColor } from '@/lib/agents/avatar-colors';
import { cn } from '@/lib/utils';
import {
  selectSelectedAgent,
  useAgentsStore,
} from '@/stores/agents-store';
import type { AgentContractData, AgentStatus } from '@/types/agent';

const STATUS_BADGE: Record<AgentStatus, string> = {
  idle: 'bg-zinc-200 text-zinc-700',
  active: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  disabled: 'bg-zinc-100 text-zinc-400',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'En attente',
  active: 'Actif',
  error: 'Erreur',
  disabled: 'Désactivé',
};

export function AgentDetailsPanel() {
  const agent = useAgentsStore(selectSelectedAgent);
  const close = useAgentsStore((s) => s.selectAgent);
  const isOpen = agent !== null;

  return (
    <aside
      aria-hidden={!isOpen}
      className={cn(
        'fixed right-0 top-0 h-full w-96 max-w-[90vw] z-10',
        'bg-white/95 dark:bg-zinc-900/95 backdrop-blur',
        'border-l border-zinc-200 dark:border-zinc-800 shadow-2xl',
        'transition-transform duration-300 ease-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {agent ? <PanelContent agent={agent} onClose={() => close(null)} /> : null}
    </aside>
  );
}

function PanelContent({
  agent,
  onClose,
}: {
  agent: AgentContractData;
  onClose: () => void;
}) {
  const accent = getAvatarColor(agent.id);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header
        className="relative px-6 py-5 border-b border-zinc-200 dark:border-zinc-800"
        style={{ borderTopColor: accent, borderTopWidth: 4 }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau"
          className="absolute right-4 top-4 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold tracking-tight">{agent.name}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {agent.role}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
              STATUS_BADGE[agent.status],
            )}
          >
            {STATUS_LABEL[agent.status]}
          </span>
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            {agent.department}
          </span>
        </div>
      </header>

      <Section title="Trigger">
        <Row label="Type" value={agent.trigger.type} />
        <Row label="Source" value={agent.trigger.source} />
      </Section>

      <Section title="Validation humaine">
        <Row
          label="Requise"
          value={agent.humanValidation.required ? 'Oui' : 'Non'}
        />
        <Row
          label="Activée"
          value={agent.humanValidation.enabled ? 'Oui' : 'Non'}
        />
      </Section>

      <Section title={`Skills (${agent.skills.length})`}>
        {agent.skills.length === 0 ? (
          <p className="text-sm text-zinc-500">Aucun skill déclaré.</p>
        ) : (
          <ul className="space-y-3">
            {agent.skills.map((skill) => (
              <li key={skill.id}>
                <p className="text-sm font-medium">{skill.name}</p>
                {skill.description ? (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                    {skill.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="I/O">
        <Row label="Inputs" value={String(agent.inputs.length)} />
        <Row label="Outputs" value={String(agent.outputs.length)} />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
