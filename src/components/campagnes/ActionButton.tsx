'use client';

/**
 * Le bouton d'ACTION SECONDAIRE du produit — celui des actions de la carte
 * campagne (« Suspendre », « Clôturer », « Réglages »).
 *
 * Il vivait en privé dans `CampaignStatusActions`. L'écran d'accueil a besoin
 * du même, et le recopier aurait fait deux boutons qui se ressemblent
 * aujourd'hui et divergent demain.
 *
 * ⚠️ Règle de page : UN SEUL bouton principal par écran. Tout le reste passe
 * par ici. Deux boutons pleins en concurrence, et le lecteur doit tout relire
 * pour savoir ce qu'on attend de lui.
 *
 * `onClick` quand l'action s'exécute sur place, `href` quand elle emmène
 * ailleurs — styles identiques, c'est la même valeur de geste.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

export type ActionVariant = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<ActionVariant, { bg: string; color: string }> = {
  success: { bg: 'rgba(21,163,100,0.1)', color: 'var(--dash-green)' },
  warning: { bg: 'rgba(213,160,0,0.12)', color: 'var(--dash-yellow)' },
  danger: { bg: 'rgba(229,72,77,0.08)', color: 'var(--dash-red)' },
  neutral: { bg: 'var(--dash-surface)', color: 'var(--dash-text-secondary)' },
};

function styleOf(variant: ActionVariant, disabled: boolean): CSSProperties {
  const tone = TONES[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    borderRadius: 8,
    border: variant === 'neutral' ? '1px solid var(--dash-border)' : 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    fontWeight: 600,
    transition: 'filter 0.15s',
    background: tone.bg,
    color: tone.color,
    opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
  };
}

type Commun = {
  variant?: ActionVariant;
  icon?: string;
  label: string;
  title?: string;
};

export function ActionButton(
  props: Commun &
    ({ onClick: () => void; disabled?: boolean } | { href: string }),
) {
  const { variant = 'neutral', icon, label, title } = props;
  const contenu = (
    <>
      {icon ? <span aria-hidden>{icon}</span> : null}
      {label}
    </>
  );

  if ('href' in props) {
    return (
      <Link
        href={props.href}
        title={title}
        className="font-body"
        style={styleOf(variant, false)}
      >
        {contenu}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled ?? false}
      title={title}
      className="font-body"
      style={styleOf(variant, props.disabled ?? false)}
    >
      {contenu}
    </button>
  );
}
