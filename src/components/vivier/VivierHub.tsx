'use client';

/**
 * Hub du Vivier de candidats (Session V1) — deux onglets internes :
 * « Déposer des CV » (upload manuel) et « Dossiers » (liste). Pattern d'onglets
 * sans route Next.
 *
 * ⚠️ La bascule est LE composant partagé (`DotTabs`), pas une barre soulignée
 * propre à cet écran : un écran ne crée jamais son composant de navigation.
 */

import { useState } from 'react';

import { DotTabs } from '@/components/ui/DotTabs';

import { VivierList } from './VivierList';
import { VivierUpload } from './VivierUpload';

type SubTab = 'upload' | 'list';

const TABS = [
  { key: 'upload' as const, label: 'Déposer des CV', dot: 'var(--dash-blue)' },
  { key: 'list' as const, label: 'Dossiers', dot: 'var(--dash-purple)' },
];

export function VivierHub() {
  const [tab, setTab] = useState<SubTab>('upload');
  // Incrémenté après un lot d'upload pour rafraîchir la liste à l'ouverture.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <DotTabs
        ariaLabel="Choisir la vue du vivier"
        tabs={TABS}
        current={tab}
        onChange={setTab}
      />

      {tab === 'upload' ? (
        <VivierUpload onUploaded={() => setRefreshKey((k) => k + 1)} />
      ) : (
        <VivierList refreshKey={refreshKey} />
      )}
    </div>
  );
}
