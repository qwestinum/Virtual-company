'use client';

/**
 * Hub de PILOTAGE (ex-Reporting, cf. docs/specs/reporting.md §1) — quatre
 * sous-onglets : Rapport de campagne, Rapport multi-campagnes, Audit, et
 * « Activité » qui recueille ce que l'écran d'accueil ne porte plus
 * (répartition par zone, fil d'activité, équipe d'agents).
 *
 * Périmètre actuel : Rapport de campagne, Rapport multi-campagnes et Audit
 * (→ Audit candidat) sont fonctionnels. Les autres types d'audit (campagne,
 * scoring) suivent le phasage de la spec (§6).
 *
 * ⚠️ Le hub ne pose pas le gabarit lui-même : c'est le sous-écran qui le rend
 * (`PilotageShell`), parce que sa barre d'outils doit se ranger dans la zone
 * de tête, au-dessus du filet, comme sur les autres onglets.
 */

import { useState } from 'react';

import { ActivityPanel } from './ActivityPanel';
import { AuditCandidatView } from './AuditCandidatView';
import { AuditHome } from './AuditHome';
import { CampaignReportList } from './CampaignReportList';
import { MultiCampaignReportView } from './MultiCampaignReportView';
import { PilotageShell } from './PilotageShell';

type SubTab = 'campaign' | 'multi' | 'audit' | 'activity';

const TABS: { key: SubTab; label: string }[] = [
  { key: 'campaign', label: 'Rapport de campagne' },
  { key: 'multi', label: 'Rapport multi-campagnes' },
  { key: 'audit', label: 'Audit' },
  { key: 'activity', label: 'Activité' },
];

export function ReportingHub() {
  // Sous-onglet ouvert par défaut : « Rapport de campagne ».
  const [tab, setTab] = useState<SubTab>('campaign');
  // Sous-vue de l'onglet Audit : accueil (3 cartes) ou audit candidat.
  const [auditView, setAuditView] = useState<'home' | 'candidat'>('home');

  // ⚠️ UNE BARRE D'ONGLETS SECONDAIRES, pas des tuiles. Les quatre tuiles à
  // emoji qui l'ont remplacée un temps n'existaient sur aucun autre écran, et
  // surtout : ces entrées ne COMPTENT rien, elles mènent à un rapport. Une
  // tuile promet un chiffre.
  const tabs = (
    <nav
      className="inline-flex flex-wrap gap-1 rounded-[10px] p-1"
      style={{ background: 'var(--dash-warm)', border: '1px solid var(--dash-border)' }}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          data-report-tab={t.key}
          aria-pressed={tab === t.key}
          onClick={() => setTab(t.key)}
          className="rounded-[8px] px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors"
          style={{
            background: tab === t.key ? 'var(--dash-surface)' : 'transparent',
            color: tab === t.key ? 'var(--dash-text)' : 'var(--dash-text-secondary)',
            border: `1px solid ${tab === t.key ? 'var(--dash-border-strong)' : 'transparent'}`,
          }}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );

  if (tab === 'campaign') return <CampaignReportList tabs={tabs} />;

  return (
    <PilotageShell tabs={tabs}>
      {tab === 'audit' ? (
        auditView === 'home' ? (
          <AuditHome onOpenCandidat={() => setAuditView('candidat')} />
        ) : (
          <AuditCandidatView onBack={() => setAuditView('home')} />
        )
      ) : tab === 'activity' ? (
        <ActivityPanel />
      ) : (
        <MultiCampaignReportView />
      )}
    </PilotageShell>
  );
}
