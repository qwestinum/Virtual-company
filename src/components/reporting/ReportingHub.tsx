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
 */

import { useState } from 'react';

import { ActivityPanel } from './ActivityPanel';
import { AuditCandidatView } from './AuditCandidatView';
import { AuditHome } from './AuditHome';
import { CampaignReportList } from './CampaignReportList';
import { MultiCampaignReportView } from './MultiCampaignReportView';

type SubTab = 'campaign' | 'multi' | 'audit' | 'activity';

const TABS: { key: SubTab; label: string; icon: string; color: string }[] = [
  { key: 'campaign', label: 'Rapport de campagne', icon: '📊', color: 'var(--dash-blue)' },
  { key: 'multi', label: 'Rapport multi-campagnes', icon: '📈', color: 'var(--dash-purple)' },
  { key: 'audit', label: 'Audit', icon: '🔍', color: 'var(--dash-teal)' },
  { key: 'activity', label: 'Activité', icon: '⚡', color: 'var(--dash-orange)' },
];

export function ReportingHub() {
  // Sous-onglet ouvert par défaut : « Rapport de campagne ».
  const [tab, setTab] = useState<SubTab>('campaign');
  // Sous-vue de l'onglet Audit : accueil (3 cartes) ou audit candidat.
  const [auditView, setAuditView] = useState<'home' | 'candidat'>('home');

  return (
    <div className="flex flex-col gap-6">
      {/* ⚠️ MÊME facture que les tuiles de Campagnes : icône, libellé lisible,
          état actif marqué par la bordure ET par le poids — jamais par la
          seule couleur. C'étaient des onglets de texte gris de 13 px, sans
          icône et sans relief ; à côté de Campagnes, l'écran paraissait d'un
          autre produit. Pas de chiffre ici : ces entrées ne comptent rien,
          elles mènent à un rapport. */}
      <nav style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="campaign-statbox block font-body"
            style={{
              background: 'var(--dash-warm)',
              borderRadius: 12,
              padding: '14px 12px',
              textAlign: 'center',
              cursor: 'pointer',
              border: `1px solid ${tab === t.key ? t.color : 'transparent'}`,
              boxShadow: tab === t.key ? `inset 0 -3px 0 ${t.color}` : undefined,
            }}
          >
            <span aria-hidden style={{ fontSize: 18, display: 'block', marginBottom: 6 }}>
              {t.icon}
            </span>
            <span
              className="font-display"
              style={{
                fontSize: 13,
                fontWeight: tab === t.key ? 800 : 600,
                color: tab === t.key ? t.color : 'var(--dash-text-secondary)',
              }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </nav>

      {tab === 'audit' ? (
        auditView === 'home' ? (
          <AuditHome onOpenCandidat={() => setAuditView('candidat')} />
        ) : (
          <AuditCandidatView onBack={() => setAuditView('home')} />
        )
      ) : tab === 'activity' ? (
        <ActivityPanel />
      ) : tab === 'campaign' ? (
        <CampaignReportList />
      ) : (
        <MultiCampaignReportView />
      )}
    </div>
  );
}
