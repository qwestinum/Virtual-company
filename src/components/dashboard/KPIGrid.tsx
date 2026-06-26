'use client';

/**
 * Grille des KPIs principaux (Session 6 ; + « À valider » HITL).
 *
 * Chaque carte montre une icône colorée, une valeur animée et un
 * label. La grille passe de 6 → 3 → 2 colonnes selon la largeur
 * disponible (rappel : on partage l'espace avec le chat à droite).
 */

import type { GlobalKPIs } from '@/lib/dashboard/derive-metrics';
import { HITL_ZONES_RECALIBRATION } from '@/lib/reporting/campaign-report';

import { AnimatedCounter } from './AnimatedCounter';
import { DASH_COLORS, type DashColor } from './tokens';

export type KPIGridProps = { kpis: GlobalKPIs };

type Item = {
  label: string;
  value: number;
  suffix?: string;
  format?: (v: number) => string;
  icon: string;
  color: DashColor;
};

export function KPIGrid({ kpis }: KPIGridProps) {
  const items: Item[] = [
    {
      label: 'CV reçus',
      value: kpis.cvReceived,
      icon: '📄',
      color: 'blue',
    },
    {
      label: 'Shortlistés / Invités',
      value: kpis.shortlisted,
      icon: '⭐',
      color: 'purple',
    },
    {
      label: 'Entretiens',
      value: kpis.interviews,
      icon: '🎯',
      color: 'teal',
    },
    { label: 'GO', value: kpis.go, icon: '✅', color: 'green' },
    {
      label: 'À valider',
      value: kpis.awaitingValidation,
      icon: '⏳',
      color: 'yellow',
    },
    {
      label: 'Conversion',
      value: kpis.conversion,
      suffix: '%',
      icon: '📈',
      color: 'orange',
    },
    {
      label: 'Coût IA',
      value: kpis.costEstimate,
      suffix: '€',
      format: (v) => v.toFixed(2),
      icon: '💰',
      color: 'pink',
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}
      >
        {items.map((it) => (
          <KPICard key={it.label} item={it} />
        ))}
      </div>
      {HITL_ZONES_RECALIBRATION ? (
        <p
          className="font-body"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--dash-text-tertiary)',
            lineHeight: 1.4,
          }}
        >
          ⚠ « Shortlistés » et « Conversion » n&apos;incluent pas les
          candidatures en zone de validation (en attente de décision) — comptage
          en cours de recalibrage (modèle 3 zones).
        </p>
      ) : null}
    </div>
  );
}

function KPICard({ item }: { item: Item }) {
  const color = DASH_COLORS[item.color];
  return (
    <div
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 16,
        padding: '16px 18px',
        transition: 'all 0.2s',
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: 20,
          width: 38,
          height: 38,
          borderRadius: 10,
          background: color.light,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        {item.icon}
      </div>
      <div
        className="font-display"
        style={{
          fontSize: 26,
          fontWeight: 800,
          marginBottom: 2,
          color: color.solid,
          fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
          lineHeight: 1.1,
        }}
      >
        <AnimatedCounter
          value={item.value}
          suffix={item.suffix}
          format={item.format}
        />
      </div>
      <div
        className="font-body"
        style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
      >
        {item.label}
      </div>
    </div>
  );
}
