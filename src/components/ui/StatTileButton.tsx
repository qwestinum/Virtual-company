'use client';

/**
 * LA TUILE DE COMPTEUR, en version SÉLECTIONNABLE.
 *
 * ⚠️ Même facture que `CampaignStatTile` — fond `--dash-warm`, rayon 12,
 * icône, gros chiffre en chasse fixe, libellé — parce que c'est la MÊME chose :
 * un compteur sur lequel on clique. Entretiens et Pilotage montraient les leurs
 * en onglets de texte gris de 13 px, sans chiffre mis en valeur, sans couleur
 * et sans icône : à côté de Campagnes, l'écran paraissait d'un autre produit.
 *
 * La différence avec la tuile de campagne est le GESTE, pas le style : celle-ci
 * SÉLECTIONNE une vue au lieu de mener à une adresse. D'où un bouton plutôt
 * qu'un lien, et un état actif marqué par la bordure ET par le poids du
 * libellé — jamais par la seule couleur.
 */

import type { CSSProperties, ReactNode } from 'react';

import { AnimatedCounter } from '@/components/dashboard/AnimatedCounter';

const BASE: CSSProperties = {
  background: 'var(--dash-warm)',
  borderRadius: 12,
  padding: '14px 12px',
  textAlign: 'center',
  cursor: 'pointer',
  width: '100%',
};

export function StatTileButton({
  icon,
  color,
  value,
  label,
  /** Total non filtré — écrit quand il diffère : un dossier caché reste compté. */
  total,
  alert,
  active,
  onClick,
}: {
  icon: string;
  color: string;
  value: number;
  label: string;
  total?: number;
  /** Compte d'ALERTE, toujours sur l'ensemble — jamais sur la vue filtrée. */
  alert?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-stat-tile={label}
      aria-pressed={active}
      onClick={onClick}
      className="campaign-statbox block"
      style={{
        ...BASE,
        border: `1px solid ${active ? color : 'transparent'}`,
        boxShadow: active ? `inset 0 -3px 0 ${color}` : undefined,
      }}
    >
      <span aria-hidden style={{ fontSize: 18, display: 'block', marginBottom: 6 }}>
        {icon}
      </span>
      <div
        className="font-data"
        style={{ fontSize: 24, fontWeight: 800, color, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}
      >
        <AnimatedCounter value={value} />
        {total !== undefined && total !== value ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--dash-text-secondary)' }}>
            sur {total}
          </span>
        ) : null}
        {alert && alert > 0 ? (
          <span
            title={`${alert} en retard`}
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: '#fff',
              background: 'var(--dash-orange)',
              borderRadius: 999,
              padding: '1px 7px',
            }}
          >
            {alert}
          </span>
        ) : null}
      </div>
      <div
        className="font-body"
        style={{
          fontSize: 11,
          color: active ? 'var(--dash-text)' : 'var(--dash-text-secondary)',
          fontWeight: active ? 700 : 500,
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </button>
  );
}

/** Une rangée de tuiles, à l'écart canonique de la carte campagne. */
export function StatTileRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {children}
    </div>
  );
}
