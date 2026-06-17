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
  /**
   * Confirmation par section : si fourni, un bouton « Enregistrer » est rendu
   * en pied de la section ouverte. Il ne persiste rien en base (la création
   * écrit tout au bouton final) — il valide le bloc, le replie et passe au
   * suivant. `saved` affiche un badge ✓ dans l'en-tête.
   */
  onSave?: () => void;
  saved?: boolean;
};

export function CollapsibleSection({
  title,
  icon,
  subtitle,
  action,
  open,
  onToggle,
  children,
  onSave,
  saved = false,
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
        {saved ? (
          <span
            className="font-body"
            aria-label="Section enregistrée"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'var(--dash-green-light)',
              color: 'var(--dash-green)',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden>✓</span> Enregistré
          </span>
        ) : null}
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
        <div style={{ padding: '12px 14px 16px' }}>
          {children}
          {onSave ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid var(--dash-border)',
              }}
            >
              <button
                type="button"
                onClick={onSave}
                className="font-display"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid var(--dash-green)`,
                  background: saved
                    ? 'var(--dash-green-light)'
                    : 'var(--dash-green)',
                  color: saved ? 'var(--dash-green)' : '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span aria-hidden>✓</span>
                {saved ? 'Enregistré' : 'Enregistrer'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
