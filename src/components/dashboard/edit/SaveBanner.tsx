'use client';

/**
 * Bannière de confirmation après une sauvegarde (Session 6 v2).
 *
 * Apparaît en haut du bloc d'édition pendant ~3 secondes pour
 * confirmer au DRH que la modification a été enregistrée et résumer
 * la répercussion (« la fiche est revalidée, la nouvelle grille
 * s'applique au prochain CV », etc.).
 *
 * Le parent passe `message` ; null/undefined cache la bannière. Le
 * timer de disparition automatique est géré par le parent via un
 * setTimeout — on garde le composant purement visuel pour le réutiliser
 * facilement.
 */

import type { ReactNode } from 'react';

export type SaveBannerProps = {
  message: string | null;
  tone?: 'success' | 'info';
};

export function SaveBanner({ message, tone = 'success' }: SaveBannerProps) {
  if (!message) return null;
  const palette: Record<NonNullable<SaveBannerProps['tone']>, ToneSpec> = {
    success: {
      bg: 'var(--dash-green-light)',
      color: 'var(--dash-green)',
      icon: '✓',
    },
    info: {
      bg: 'var(--dash-blue-light)',
      color: 'var(--dash-blue)',
      icon: 'ℹ',
    },
  };
  const p = palette[tone];
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        marginBottom: 10,
        borderRadius: 10,
        background: p.bg,
        color: p.color,
        fontSize: 12,
        fontFamily: 'var(--font-nunito), system-ui, sans-serif',
      }}
    >
      <span aria-hidden style={{ fontWeight: 800 }}>
        {p.icon}
      </span>
      <span style={{ fontWeight: 600 }}>{message}</span>
    </div>
  );
}

export function SaveFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
}

type ToneSpec = { bg: string; color: string; icon: string };
