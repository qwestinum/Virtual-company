'use client';

import { useState } from 'react';

import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { cn } from '@/lib/utils';

type Tab = 'rh' | 'dashboard';

const TABS: { id: Tab; label: string; available: boolean }[] = [
  { id: 'rh', label: 'Département RH', available: true },
  { id: 'dashboard', label: 'Dashboard', available: false },
];

export function WorkspacePane() {
  const [tab, setTab] = useState<Tab>('rh');
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      <WorkspaceTabs current={tab} onChange={setTab} />
      <div className="relative flex-1 overflow-hidden">
        {tab === 'rh' ? (
          <>
            <HRDepartmentView />
            <AgentDetailsPanel />
          </>
        ) : (
          <DashboardPlaceholder />
        )}
      </div>
    </div>
  );
}

function WorkspaceTabs({
  current,
  onChange,
}: {
  current: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Espaces de travail"
      className="relative z-20 flex items-end gap-1 px-6 pt-4 border-b border-stone-200/60 bg-white/50 backdrop-blur-sm"
    >
      {TABS.map((tab) => {
        const isActive = current === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={!tab.available}
            disabled={!tab.available && !isActive}
            onClick={() => tab.available && onChange(tab.id)}
            className={cn(
              'relative px-4 pb-2.5 pt-2 transition-all',
              'font-display font-bold text-[15px] tracking-tight',
              isActive
                ? 'bg-clip-text bg-gradient-to-r from-indigo-700 via-violet-600 to-emerald-600 text-transparent'
                : tab.available
                  ? 'text-stone-500 hover:text-stone-800'
                  : 'text-stone-400 cursor-not-allowed',
            )}
          >
            <span>{tab.label}</span>
            {!tab.available ? (
              <span className="ml-2 align-middle text-[9px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                Bientôt
              </span>
            ) : null}
            {isActive ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full bg-gradient-to-r from-indigo-600 via-violet-500 to-emerald-500"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function DashboardPlaceholder() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center max-w-md px-6">
        <p className="font-display font-bold text-4xl tracking-tight bg-clip-text bg-gradient-to-r from-indigo-700 via-violet-600 to-emerald-600 text-transparent">
          Dashboard
        </p>
        <p className="mt-3 font-body text-[14px] text-stone-500 leading-relaxed">
          Vue agrégée des campagnes en cours, métriques agents et journal
          d'actions. Disponible à partir de la Session 5.
        </p>
      </div>
    </div>
  );
}
