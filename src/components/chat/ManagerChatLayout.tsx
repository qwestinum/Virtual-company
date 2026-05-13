'use client';

/**
 * Wrapper d'affichage du Manager Chat (Session 6 v2).
 *
 * Le chat n'est plus visible par défaut. Une tablette verticale verte
 * « Chat Manager » est ancrée au bord droit ; un clic déploie le
 * panneau (slide-in) et un second clic le replie. La tablette reste
 * accessible quand le panneau est ouvert pour permettre la fermeture
 * symétrique.
 *
 * Pour ne pas casser la mise en page existante, le composant prend
 * tout l'espace fixé par le parent ; seul le slide est animé.
 */

import { useState } from 'react';

import { ManagerChat } from './ManagerChat';

const PANEL_WIDTH = 'min(720px, 50vw)';
const TAB_WIDTH = 38;

export function ManagerChatLayout() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fermer le chat Manager' : 'Ouvrir le chat Manager'}
        aria-expanded={open}
        style={{
          position: 'fixed',
          top: '50%',
          right: 0,
          transform: 'translateY(-50%)',
          zIndex: 60,
          width: TAB_WIDTH,
          padding: '18px 0',
          border: 'none',
          borderTopLeftRadius: 10,
          borderBottomLeftRadius: 10,
          background: 'linear-gradient(180deg, #15a364 0%, #12a594 100%)',
          color: '#ffffff',
          cursor: 'pointer',
          boxShadow: '-2px 4px 14px rgba(15, 23, 42, 0.18)',
          letterSpacing: '0.05em',
          fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 12,
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
        }}
      >
        {open ? 'Fermer' : 'Chat Manager'}
      </button>
      <aside
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: PANEL_WIDTH,
          background: 'rgba(250, 248, 245, 0.96)',
          backdropFilter: 'blur(6px)',
          borderLeft: '1px solid rgba(212, 205, 197, 0.65)',
          boxShadow: open ? '-20px 0 40px rgba(15, 23, 42, 0.12)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          zIndex: 55,
          display: 'flex',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <ManagerChat />
        </div>
      </aside>
    </>
  );
}
