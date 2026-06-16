'use client';

/**
 * Section pliable/dépliable pour l'étape d'édition de la création de campagne.
 *
 * Donne de la visibilité quand une fiche récupérée préremplit plusieurs blocs :
 * au lieu d'un mur de blocs à plat, chaque bloc est replié avec un résumé
 * (sous-titre) et déplié à la demande. Une action optionnelle (ex. « Proposer la
 * fiche ») vit dans l'en-tête SANS replier la section au clic (pas de bouton
 * imbriqué : l'en-tête est un conteneur, pas un bouton).
 */

import type { ReactNode } from 'react';

export type CollapsibleSectionProps = {
  title: string;
  icon: string;
  /** Résumé court affiché replié (ex. « 3 critères », « 2 flux »). */
  subtitle?: string;
  /** Action d'en-tête optionnelle (bouton « Proposer… »), ne replie pas. */
  action?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  icon,
  subtitle,
  action,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <section
      style={{
        border: `1px solid ${open ? 'var(--dash-border-strong)' : 'var(--dash-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--dash-surface)',
        transition: 'border-color 0.15s',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: open ? 'var(--dash-warm)' : 'transparent',
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="font-display"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
          }}
        >
          <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
            {icon}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--dash-text)',
              }}
            >
              {title}
            </span>
            {subtitle ? (
              <span
                className="font-body"
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'var(--dash-text-tertiary)',
                  marginTop: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subtitle}
              </span>
            ) : null}
          </span>
        </button>
        {action}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Replier' : 'Déplier'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--dash-text-tertiary)',
            fontSize: 14,
            padding: 4,
            transition: 'transform 0.2s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </button>
      </div>
      {open ? (
        <div style={{ padding: '12px 14px 16px' }}>{children}</div>
      ) : null}
    </section>
  );
}
