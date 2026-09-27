'use client';

/**
 * Le pied de l'assistant : retour à gauche, geste principal à droite.
 *
 * ⚠️ « Suivant » désactivé DIT pourquoi, en nommant ce qui manque, dans une
 * phrase posée À CÔTÉ du bouton. Un bouton grisé muet est la même impasse
 * qu'un bouton qui ne mène nulle part : on ne sait pas quoi faire, et on ne
 * sait même pas qu'il y a quelque chose à faire.
 */

import type { CSSProperties } from 'react';

import { SECONDAIRE } from './AssistantChrome';

const PRIMAIRE: CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
};

const PRIMAIRE_OFF: CSSProperties = {
  ...PRIMAIRE,
  background: 'var(--dash-hover)',
  color: 'var(--dash-text-tertiary)',
  cursor: 'not-allowed',
  boxShadow: undefined,
};

export function AssistantFooter({
  onBack,
  onNext,
  nextLabel,
  blockedReason,
  busy,
}: {
  onBack: (() => void) | null;
  onNext: () => void;
  nextLabel: string;
  /** `null` = l'étape passe. Sinon, la phrase s'affiche À CÔTÉ du bouton. */
  blockedReason: string | null;
  busy: boolean;
}) {
  const bloque = blockedReason !== null || busy;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '14px 22px',
        borderTop: '1px solid var(--dash-border)',
        background: 'var(--dash-warm)',
      }}
    >
      <div>
        {onBack ? (
          <button type="button" onClick={onBack} className="font-body" style={SECONDAIRE}>
            ← Retour
          </button>
        ) : (
          <span />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {blockedReason ? (
          <span
            // Repère STABLE : `role="status"` ne suffit PAS à désigner cette
            // phrase — le bandeau de notifications du workspace en porte un
            // aussi, et un test qui prend « le premier » lit le mauvais texte
            // dès qu'une alerte est à l'écran (défaut attrapé en jouant S29 et
            // S30 à la suite).
            data-role="blocked-reason"
            role="status"
            className="font-body"
            style={{ fontSize: 12, color: 'var(--dash-orange)', textAlign: 'right' }}
          >
            {blockedReason}
          </span>
        ) : null}
        <button
          type="button"
          data-role="next"
          onClick={onNext}
          disabled={bloque}
          className="font-display"
          style={bloque ? PRIMAIRE_OFF : PRIMAIRE}
        >
          {busy ? 'Enregistrement…' : nextLabel}
        </button>
      </div>
    </div>
  );
}

