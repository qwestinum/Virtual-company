'use client';

/**
 * « Ce n'est pas encore activé — voulez-vous l'activer ? », posé LÀ où le geste
 * se fait.
 *
 * Renvoyer vers un formulaire de réglages, c'est demander de refaire le chemin
 * pour une case à cocher : vouloir diffuser EST le moment où l'on choisit son
 * canal. On DIT ce que le bouton change sur la campagne — c'est une écriture,
 * pas une préférence d'affichage.
 */

import { useState } from 'react';

const BOUTON: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
};

export type OptInChoice = { key: string; label: string; detail: string };

export function SurfaceOptIn({
  titre,
  explication,
  choix,
  onChoisir,
}: {
  titre: string;
  explication: string;
  choix: readonly OptInChoice[];
  onChoisir: (key: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      data-optin
      style={{
        border: '1px solid var(--dash-border-strong)',
        borderRadius: 12,
        padding: '18px 18px 16px',
        background: 'var(--dash-warm)',
      }}
    >
      <h2
        className="font-display"
        style={{ fontSize: 15, fontWeight: 700, color: 'var(--dash-text)', margin: 0 }}
      >
        {titre}
      </h2>
      <p
        className="font-body"
        style={{ fontSize: 13, color: 'var(--dash-text-secondary)', margin: '6px 0 14px', lineHeight: 1.55 }}
      >
        {explication}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {choix.map((c) => (
          <div
            key={c.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--dash-border)',
              background: 'var(--dash-surface)',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                className="font-body"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--dash-text)', display: 'block' }}
              >
                {c.label}
              </span>
              <span
                className="font-body"
                style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
              >
                {c.detail}
              </span>
            </span>
            <button
              type="button"
              data-optin-choice={c.key}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(c.key);
                setError(null);
                const outcome = await onChoisir(c.key);
                setBusy(null);
                if (!outcome.ok) setError(outcome.message);
              }}
              className="font-display"
              style={{
                ...BOUTON,
                opacity: busy !== null && busy !== c.key ? 0.5 : 1,
                cursor: busy !== null ? 'progress' : 'pointer',
              }}
            >
              {busy === c.key ? 'Enregistrement…' : 'Choisir'}
            </button>
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 10, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
