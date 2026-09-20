'use client';

/**
 * « + Nouvelle campagne » — le bouton EXISTANT, extrait pour être partagé.
 *
 * Il vivait en privé dans `CampaignsList`. L'écran d'accueil offre le même
 * raccourci, et le recopier aurait fait deux boutons qui se ressemblent
 * aujourd'hui et divergent demain. Un seul composant, deux points de montage,
 * styles IDENTIQUES — c'est le même geste.
 *
 * `onClick` sur la page Campagnes, où la feuille s'ouvre sur place ; `href`
 * depuis l'accueil, où il faut d'abord aller à Campagnes.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

const STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px 6px 8px',
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.02em',
  boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
  whiteSpace: 'nowrap',
};

function Contenu() {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.22)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        +
      </span>
      Nouvelle campagne
    </>
  );
}

export function AddCampaignButton(
  props: { onClick: () => void } | { href: string },
) {
  if ('href' in props) {
    return (
      <Link
        href={props.href}
        aria-label="Ajouter une nouvelle campagne"
        className="font-display"
        style={STYLE}
      >
        <Contenu />
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label="Ajouter une nouvelle campagne"
      className="font-display"
      style={STYLE}
    >
      <Contenu />
    </button>
  );
}
