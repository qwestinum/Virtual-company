'use client';

/**
 * Carte « Activité en direct » (Session 6).
 *
 * Affiche les 20 dernières activités du journal traduites en messages
 * métier. Le mapping icône+couleur vient déjà du derive (clé), on
 * résout les valeurs CSS ici.
 */

import type {
  ActivityColorKey,
  ActivityIconKey,
  ActivityItem,
} from '@/lib/dashboard/derive-metrics';

import { DASH_COLORS, type DashColor } from './tokens';

export type ActivityCardProps = {
  activity: ActivityItem[];
};

const ICONS: Record<ActivityIconKey, string> = {
  cv: '📄',
  mail: '✉️',
  calendar: '📅',
  interview: '🎯',
  announce: '📢',
  rocket: '🚀',
  pause: '⏸',
  play: '▶️',
  edit: '✏️',
};

export function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <section
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 16,
        padding: 22,
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        // Hauteur fixe → la liste scrolle indépendamment du reste du dashboard.
        height: 360,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h3
          className="font-display"
          style={{
            fontSize: 17,
            fontWeight: 800,
            margin: 0,
            color: 'var(--dash-text)',
          }}
        >
          Activité en direct
        </h3>
        <span
          className="font-data"
          style={{
            fontSize: 11,
            color: 'var(--dash-text-tertiary)',
          }}
        >
          {activity.length} évènement{activity.length > 1 ? 's' : ''}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: 4,
          marginRight: -4,
        }}
      >
        {activity.length === 0 ? (
          <div
            className="font-body"
            style={{
              padding: '20px 8px',
              textAlign: 'center',
              color: 'var(--dash-text-tertiary)',
              fontSize: 13,
            }}
          >
            Pas encore d&apos;activité. Les actions apparaîtront ici dès qu&apos;un agent
            se mettra au travail.
          </div>
        ) : (
          activity.map((item, i) => (
            <ActivityRow key={item.id} item={item} delayMs={i * 40} />
          ))
        )}
      </div>
    </section>
  );
}

function ActivityRow({
  item,
  delayMs,
}: {
  item: ActivityItem;
  delayMs: number;
}) {
  const color = colorOf(item.colorKey);
  return (
    <div
      className="dash-fade-in"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '9px 12px',
        borderRadius: 10,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: 15,
          width: 32,
          height: 32,
          borderRadius: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: `${color}1a`,
        }}
      >
        {ICONS[item.iconKey]}
      </div>
      <span
        className="font-body"
        style={{ flex: 1, fontSize: 13, color: 'var(--dash-text)' }}
      >
        {item.message}
        {item.campaignId ? (
          <span style={{ color: 'var(--dash-text-tertiary)' }}>
            {' '}
            ({item.campaignId})
          </span>
        ) : null}
      </span>
      <span
        className="font-data"
        style={{
          fontSize: 11,
          color: 'var(--dash-text-tertiary)',
          flexShrink: 0,
        }}
      >
        {item.time}
      </span>
    </div>
  );
}

function colorOf(key: ActivityColorKey): string {
  return DASH_COLORS[key as DashColor].solid;
}
