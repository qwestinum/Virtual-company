'use client';

/**
 * Tuile de statistique — la tuile EXISTANTE de la carte campagne, extraite.
 *
 * Fond `--dash-warm`, rayon 12, icône, gros chiffre en chasse fixe, libellé.
 * Elle vivait en privé dans `CampaignCardBody`. Seul son CONTENU change avec
 * l'option A (des étapes courantes, plus des trajectoires) — sa facture, non :
 * « zéro invention » veut dire réutiliser ce qui existe, pas le remplacer par
 * des rangées à bordure.
 *
 * `href` plutôt que `onClick` : un compteur est devenu une ADRESSE. Faire
 * remonter un clic jusqu'à l'écran pour redescendre en navigation n'avait de
 * sens que tant qu'aucune URL n'existait.
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { AnimatedCounter } from '@/components/dashboard/AnimatedCounter';

const BASE: CSSProperties = {
  background: 'var(--dash-warm)',
  borderRadius: 12,
  padding: '14px 12px',
  textAlign: 'center',
};

function Contenu({
  icon,
  value,
  label,
  color,
}: {
  icon: string;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <>
      <span aria-hidden style={{ fontSize: 18, display: 'block', marginBottom: 6 }}>
        {icon}
      </span>
      <div className="font-data" style={{ fontSize: 24, fontWeight: 800, color }}>
        <AnimatedCounter value={value} />
      </div>
      <div
        className="font-body"
        style={{ fontSize: 11, color: 'var(--dash-text-secondary)', marginTop: 4 }}
      >
        {label}
      </div>
    </>
  );
}

export function CampaignStatTile({
  icon,
  color,
  value,
  label,
  href,
}: {
  icon: string;
  color: string;
  value: number;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      title={`Voir les candidatures — ${label}`}
      aria-label={`Voir les candidatures de la campagne — ${label}`}
      className="campaign-statbox block"
      style={{ ...BASE, border: '1px solid transparent', textDecoration: 'none' }}
    >
      <Contenu icon={icon} value={value} label={label} color={color} />
    </Link>
  );
}

/**
 * Tuile d'une PORTE d'entrée de candidatures — même facture, autre contenu :
 * une icône, un libellé d'action, une ligne d'état.
 *
 * ⚠️ Fermée sur un brouillon : la tuile reste, atténuée, et la RAISON prend la
 * place de l'état. Un bouton grisé sans un mot ne déplace pas le besoin, il le
 * supprime.
 */
export function CampaignSourceTile({
  icon,
  color,
  label,
  state,
  href,
  reason,
}: {
  icon: string;
  color: string;
  label: string;
  state: string;
  href: string | null;
  reason: string | null;
}) {
  const corps: ReactNode = (
    <>
      <span aria-hidden style={{ fontSize: 18, display: 'block', marginBottom: 6 }}>
        {icon}
      </span>
      <div
        className="font-display"
        style={{ fontSize: 13, fontWeight: 700, color: href ? color : 'var(--dash-text-secondary)' }}
      >
        {label}
      </div>
      <div
        className="font-body"
        style={{
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.4,
          color: 'var(--dash-text-secondary)',
        }}
      >
        {href ? state : (reason ?? state)}
      </div>
    </>
  );

  if (!href) {
    return (
      <div style={{ ...BASE, opacity: 0.6 }} aria-disabled>
        {corps}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="campaign-statbox block"
      style={{ ...BASE, border: '1px solid transparent', textDecoration: 'none' }}
    >
      {corps}
    </Link>
  );
}

/**
 * Squelette d'une tuile de porte — MÊME HAUTEUR que la tuile pleine, pour que
 * l'arrivée des états ne fasse sauter aucune ligne. Un écran qui se réorganise
 * sous le curseur fait rater le clic qu'on avait déjà visé.
 */
export function CampaignSourceTileSkeleton() {
  return (
    <div style={{ ...BASE }} aria-hidden>
      <span style={{ fontSize: 18, display: 'block', marginBottom: 6, opacity: 0 }}>
        •
      </span>
      <div style={{ height: 17, borderRadius: 4, background: 'var(--dash-hover)' }} />
      <div
        style={{
          marginTop: 6,
          height: 26,
          borderRadius: 4,
          background: 'var(--dash-hover)',
          opacity: 0.6,
        }}
      />
    </div>
  );
}
