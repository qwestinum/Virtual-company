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

import { DotTabs } from '@/components/ui/DotTabs';

import { AuditCandidatView } from './AuditCandidatView';
import { AuditHome } from './AuditHome';
import { CampaignReportList } from './CampaignReportList';
import { MultiCampaignReportView } from './MultiCampaignReportView';
import { PilotageShell } from './PilotageShell';

/**
 * ⚠️ « Activité » est MASQUÉE (21/09/2026). Elle hébergeait le vieux Bureau
 * (cartes d'agents, lignes de flux) et le fil d'activité : un écran d'une
 * autre époque, sans rapport avec le reste de Pilotage. Le composant reste au
 * dépôt, il n'a plus de porte.
 */
type SubTab = 'campaign' | 'multi' | 'audit';

const TABS: { key: SubTab; label: string; dot: string }[] = [
  { key: 'campaign', label: 'Rapport de campagne', dot: 'var(--dash-blue)' },
  { key: 'multi', label: 'Multi-campagnes', dot: 'var(--dash-purple)' },
  { key: 'audit', label: 'Audit', dot: 'var(--dash-teal)' },
];

export function ReportingHub() {
  // Sous-onglet ouvert par défaut : « Rapport de campagne ».
  const [tab, setTab] = useState<SubTab>('campaign');
  // Sous-vue de l'onglet Audit : accueil (3 cartes) ou audit candidat.
  const [auditView, setAuditView] = useState<'home' | 'candidat'>('home');

  // ⚠️ LES PUCES À POINT COLORÉ, celles de Diffusion et de « Revue de
  // candidature » (essai du 22/09/2026, à la demande du donneur d'ordre) :
  // trois vues sans chiffre, c'est une navigation — la puce le dit mieux
  // qu'une carte-compteur, qui promet un volume à comparer.
  const tabs = (
    <DotTabs
      ariaLabel="Choisir le rapport"
      current={tab}
      onChange={setTab}
      tabs={TABS}
    />
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
      ) : (
        <MultiCampaignReportView />
      )}
    </PilotageShell>
  );
}
