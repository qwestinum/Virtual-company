'use client';

/**
 * Hub du module Reporting (cf. docs/specs/reporting.md §1) — trois
 * sous-onglets : Rapport de campagne, Rapport multi-campagnes, Audit.
 *
 * Périmètre actuel : Rapport de campagne, Rapport multi-campagnes et Audit
 * (→ Audit candidat) sont fonctionnels. Les autres types d'audit (campagne,
 * scoring) suivent le phasage de la spec (§6).
 */

import { useState } from 'react';

import { AuditCandidatView } from './AuditCandidatView';
import { AuditHome } from './AuditHome';
import { CampaignReportList } from './CampaignReportList';
import { MultiCampaignReportView } from './MultiCampaignReportView';

type SubTab = 'campaign' | 'multi' | 'audit';

const TABS: { key: SubTab; label: string }[] = [
  { key: 'campaign', label: 'Rapport de campagne' },
  { key: 'multi', label: 'Rapport multi-campagnes' },
  { key: 'audit', label: 'Audit' },
];

export function ReportingHub() {
  // Sous-onglet ouvert par défaut : « Rapport de campagne ».
  const [tab, setTab] = useState<SubTab>('campaign');
  // Sous-vue de l'onglet Audit : accueil (3 cartes) ou audit candidat.
  const [auditView, setAuditView] = useState<'home' | 'candidat'>('home');

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

      {tab === 'audit' ? (
        auditView === 'home' ? (
          <AuditHome onOpenCandidat={() => setAuditView('candidat')} />
        ) : (
          <AuditCandidatView onBack={() => setAuditView('home')} />
        )
      ) : tab === 'campaign' ? (
        <CampaignReportList />
      ) : (
        <MultiCampaignReportView />
      )}
    </div>
  );
}
