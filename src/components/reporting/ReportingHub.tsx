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

import { CounterRibbon } from '@/components/ui/CounterRibbon';

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

  // ⚠️ LE RUBAN DE CARTES-COMPTEURS, celui d'Entretiens et de Candidatures —
  // même carte, même soulignement coloré, même état sélectionné, même hauteur,
  // étirées sur la largeur. Cet écran s'était fabriqué une barre segmentée,
  // puis des puces : deux formes de plus pour le même geste. Sans chiffre ici,
  // parce qu'il n'y en a pas — le composant l'accepte, il n'est pas recopié.
  const tabs = (
    <CounterRibbon
      active={tab}
      onSelect={(k) => setTab((k ?? 'campaign') as SubTab)}
      items={TABS.map((t) => ({ key: t.key, label: t.label, color: t.dot }))}
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
