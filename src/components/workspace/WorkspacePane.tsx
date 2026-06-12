'use client';

import { useEffect, useState } from 'react';

import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { CampaignsWorkspace } from '@/components/campagnes/CampaignsWorkspace';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ReportingHub } from '@/components/reporting/ReportingHub';
import { ValidationsHub } from '@/components/validations/ValidationsHub';
import { cn } from '@/lib/utils';

type Tab = 'rh' | 'campagnes' | 'dashboard' | 'validations' | 'reporting';

const TABS: { id: Tab; label: string; available: boolean }[] = [
  { id: 'rh', label: 'Bureau', available: true },
  { id: 'campagnes', label: 'Campagnes', available: true },
  { id: 'dashboard', label: 'Dashboard', available: true },
  { id: 'validations', label: 'Validation suspendue', available: true },
  { id: 'reporting', label: 'Reporting', available: true },
];

/** Compteur de validations en attente (badge d'onglet). Best-effort. */
function usePendingValidationsCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { validations?: unknown[] };
        if (!cancelled) setCount(json.validations?.length ?? 0);
      } catch {
        // silencieux
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

export function WorkspacePane() {
  const [tab, setTab] = useState<Tab>('rh');
  const pendingCount = usePendingValidationsCount();
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      <WorkspaceTabs
        current={tab}
        onChange={setTab}
        pendingCount={pendingCount}
      />
      <div className="relative flex-1 overflow-hidden">
        {tab === 'rh' ? (
          <>
            <HRDepartmentView />
            <AgentDetailsPanel />
          </>
        ) : tab === 'campagnes' ? (
          <CampaignsWorkspace />
        ) : tab === 'dashboard' ? (
          <DashboardView />
        ) : tab === 'validations' ? (
          <div className="h-full overflow-auto px-6 py-6">
            <div className="mx-auto w-full max-w-6xl">
              <ValidationsHub />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto px-6 py-6">
            <div className="mx-auto w-full max-w-4xl">
              <ReportingHub />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceTabs({
  current,
  onChange,
  pendingCount,
}: {
  current: Tab;
  onChange: (tab: Tab) => void;
  pendingCount: number;
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
            {tab.id === 'validations' && pendingCount > 0 ? (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 align-middle font-data text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            ) : null}
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
      <SettingsGearLink />
    </nav>
  );
}

/**
 * Bouton engrenage poussé à droite de la barre d'onglets — accès
 * toujours visible vers /settings, quel que soit l'onglet courant.
 */
function SettingsGearLink() {
  return (
    <a
      href="/settings"
      aria-label="Paramètres"
      title="Paramètres"
      className={cn(
        'ml-auto mb-1 mr-0 inline-flex items-center justify-center',
        'w-9 h-9 rounded-full',
        'text-stone-500 hover:text-stone-900 hover:bg-stone-100',
        'transition',
      )}
    >
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </a>
  );
}

