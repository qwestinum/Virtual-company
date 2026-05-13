'use client';

/**
 * Grille des 6 KPIs principaux (Session 6).
 *
 * Chaque carte montre une icône colorée, une valeur animée et un
 * label. La grille passe de 6 → 3 → 2 colonnes selon la largeur
 * disponible (rappel : on partage l'espace avec le chat à droite).
 */

import type { GlobalKPIs } from '@/lib/dashboard/derive-metrics';

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
      label: 'Shortlistés',
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginBottom: 24,
      }}
    >
      {items.map((it) => (
        <KPICard key={it.label} item={it} />
      ))}
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
