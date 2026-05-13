'use client';

/**
 * En-tête du dashboard avec logo et badge système (Session 6).
 *
 * Le badge passe en mode dégradé visuel quand le payload arrive avec
 * `offline: true` (Supabase absent) — la démo reste lisible mais on
 * signale honnêtement l'absence de persistance.
 */

export type DashboardHeaderProps = {
  offline: boolean;
  isStale: boolean;
};

export function DashboardHeader({ offline, isStale }: DashboardHeaderProps) {
  const live = !offline && !isStale;
  const label = offline
    ? 'Mode local'
    : isStale
      ? 'Reconnexion…'
      : 'Système actif';
  const bg = offline
    ? 'var(--dash-hover)'
    : isStale
      ? 'var(--dash-yellow-light)'
      : 'var(--dash-green-light)';
  const color = offline
    ? 'var(--dash-text-secondary)'
    : isStale
      ? 'var(--dash-yellow)'
      : 'var(--dash-green)';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 28,
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 4,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background:
                'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
              color: '#fff',
            }}
          >
            ⚡
          </div>
          <span
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.5px',
              color: 'var(--dash-text)',
            }}
          >
            ORQA
          </span>
        </div>
        <div
          className="font-body"
          style={{ fontSize: 14, color: 'var(--dash-text-secondary)' }}
        >
          Recruitment AI — Dashboard
        </div>
      </div>
      <div
        className="font-data"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          borderRadius: 10,
          background: bg,
          color,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
            boxShadow: live ? `0 0 8px ${color}` : undefined,
          }}
        />
        {label}
      </div>
    </div>
  );
}
