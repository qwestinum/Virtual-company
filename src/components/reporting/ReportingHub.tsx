'use client';

/**
 * Hub du module Reporting (cf. docs/specs/reporting.md §1) — trois
 * sous-onglets : Rapport de campagne, Rapport multi-campagnes, Audit.
 *
 * Périmètre actuel : Rapport de campagne + Audit (→ Audit candidat) sont
 * fonctionnels. Le sous-onglet multi-campagnes reste « Bientôt disponible »
 * (phasage de la spec, §6).
 */

import { useState } from 'react';

import { AuditCandidatView } from './AuditCandidatView';
import { AuditHome } from './AuditHome';
import { CampaignReportList } from './CampaignReportList';

type SubTab = 'campaign' | 'multi' | 'audit';

const TABS: { key: SubTab; label: string }[] = [
  { key: 'campaign', label: 'Rapport de campagne' },
  { key: 'multi', label: 'Rapport multi-campagnes' },
  { key: 'audit', label: 'Audit' },
];

export function ReportingHub() {
  const [tab, setTab] = useState<SubTab>('audit');
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
        <ComingSoon title="Rapport multi-campagnes" />
      )}
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-6 py-12 text-center">
      <p className="font-display text-[15px] font-bold text-stone-700">{title}</p>
      <p className="mt-1 font-body text-[13px] text-stone-500">
        Bientôt disponible — ce sous-onglet suit le phasage du module Reporting.
      </p>
    </div>
  );
}
