'use client';

/**
 * Pill de statut réutilisable pour campagnes et candidats (Session 6).
 *
 * Variantes alignées sur la maquette :
 *   - active   → vert (avec halo lumineux sur le dot)
 *   - paused   → jaune
 *   - draft    → gris
 *   - analyzed → bleu
 *   - invited  → violet
 *   - scheduled → orange
 *   - interview_done → teal
 *   - rejected → rouge
 *
 * Le `glow` n'est activé que pour les statuts vivants (active, scheduled)
 * pour rappeler que la campagne est en écoute, sans surcharger la grille
 * d'animations sinon.
 */

import { DASH_COLORS, type DashColor } from './tokens';

export type PillKind =
  | 'active'
  | 'paused'
  | 'draft'
  | 'closed'
  | 'analyzed'
  | 'invited'
  | 'scheduled'
  | 'interview_done'
  | 'rejected';

type PillSpec = {
  label: string;
  color: DashColor | 'gray';
  glow?: boolean;
};

const SPECS: Record<PillKind, PillSpec> = {
  active: { label: 'Active', color: 'green', glow: true },
  paused: { label: 'Suspendue', color: 'yellow' },
  draft: { label: 'Brouillon', color: 'gray' },
  closed: { label: 'Clôturée', color: 'gray' },
  analyzed: { label: 'Analysé', color: 'blue' },
  invited: { label: 'Invité', color: 'purple' },
  scheduled: { label: 'Planifié', color: 'orange' },
  interview_done: { label: 'Entretien fait', color: 'teal' },
  rejected: { label: 'Non retenu', color: 'red' },
};

export function StatusPill({ kind }: { kind: PillKind }) {
  const spec = SPECS[kind];
  const solid =
    spec.color === 'gray'
      ? 'var(--dash-text-tertiary)'
      : DASH_COLORS[spec.color].solid;
  const light =
    spec.color === 'gray'
      ? 'var(--dash-hover)'
      : DASH_COLORS[spec.color].light;
  return (
    <span
      className="font-body"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 20,
        background: light,
        color: solid,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: solid,
          boxShadow: spec.glow ? `0 0 6px ${solid}` : undefined,
        }}
      />
      {spec.label}
    </span>
  );
}
