'use client';

/**
 * Hub du Vivier de candidats (Session V1) — deux onglets internes :
 * « Déposer des CV » (upload manuel) et « Dossiers » (liste). Pattern d'onglets
 * sans route Next, aligné sur ReportingHub.
 */

import { useState } from 'react';

import { VivierList } from './VivierList';
import { VivierUpload } from './VivierUpload';

type SubTab = 'upload' | 'list';

const TABS: { key: SubTab; label: string }[] = [
  { key: 'upload', label: 'Déposer des CV' },
  { key: 'list', label: 'Dossiers' },
];

export function VivierHub() {
  const [tab, setTab] = useState<SubTab>('upload');
  // Incrémenté après un lot d'upload pour rafraîchir la liste à l'ouverture.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 font-body text-[13px] font-semibold transition-colors ${
              tab === t.key
                ? 'border-amber-500 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'upload' ? (
        <VivierUpload onUploaded={() => setRefreshKey((k) => k + 1)} />
      ) : (
        <VivierList refreshKey={refreshKey} />
      )}
    </div>
  );
}
