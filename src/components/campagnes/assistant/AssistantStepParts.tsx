'use client';

/**
 * Les briques de mise en page d'une étape : une note, un sous-titre, une
 * PARTIE. Sorties du corps d'étape, qui n'a pas à porter à la fois ce qu'il
 * montre et la façon de le montrer.
 */

import type { ReactNode } from 'react';

export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-body"
      style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginTop: 14, lineHeight: 1.5 }}
    >
      {children}
    </p>
  );
}

/**
 * Une PARTIE d'étape : un titre, un sous-titre, un contenu. `accent` marque
 * celle qui engage quelque chose — deux parties de même poids se lisent comme
 * une seule.
 */
export function Partie({
  titre,
  sousTitre,
  accent,
  children,
}: {
  titre: string;
  sousTitre: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    // ⚠️ LES DEUX parties sont encadrées, sinon la première se lit comme une
    // description et non comme un réglage — du noir sur blanc au-dessus d'un
    // bloc coloré, l'œil n'y voit qu'une seule partie. Même cadre, deux tons :
    // sobre pour le choix d'un référent (un réglage d'annuaire), vif pour ce
    // qui engage des envois.
    <section
      style={{
        marginBottom: 14,
        padding: '16px 16px 14px',
        borderRadius: 12,
        border: `1px solid ${accent ? 'var(--dash-purple)' : 'var(--dash-border-strong)'}`,
        background: accent ? 'var(--dash-purple-light)' : 'var(--dash-warm)',
      }}
    >
      <h3
        className="font-display"
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: accent ? 'var(--dash-purple)' : 'var(--dash-text)',
          margin: 0,
        }}
      >
        {titre}
      </h3>
      <p
        className="font-body"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          margin: '3px 0 10px',
        }}
      >
        {sousTitre}
      </p>
      {children}
    </section>
  );
}

export function SousTitre({ children }: { children: ReactNode }) {
  return (
    <h3
      className="font-display"
      style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-text)', margin: '18px 0 8px' }}
    >
      {children}
    </h3>
  );
}
