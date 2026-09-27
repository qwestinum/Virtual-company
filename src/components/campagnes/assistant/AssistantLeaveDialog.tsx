'use client';

/**
 * Quitter l'assistant sans avoir lancé — on DEMANDE, puis on CONFIRME.
 *
 * ⚠️ Deux temps, et chacun a sa raison. Fermer sans rien dire laisse partir
 * avec le doute (« est-ce que j'ai tout perdu ? ») ; c'est précisément la
 * question que l'assistant passe son temps à désamorcer. Et un « oui » suivi
 * d'un retour muet à la liste ne répond pas non plus : on DIT que la campagne
 * est en brouillon et qu'elle se reprend.
 *
 * Quand rien n'est encore enregistré, la question est franche : ce qui est à
 * l'écran sera perdu.
 */

import { useState } from 'react';

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15, 23, 42, 0.45)',
  backdropFilter: 'blur(2px)',
};

const CARTE: React.CSSProperties = {
  width: 'min(460px, calc(100% - 32px))',
  background: 'var(--dash-surface)',
  border: '1px solid var(--dash-border)',
  borderRadius: 14,
  padding: '22px 22px 18px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};

const PRIMAIRE: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const SECONDAIRE: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 8,
  border: '1px solid var(--dash-border)',
  background: 'var(--dash-surface)',
  color: 'var(--dash-text-secondary)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

export function AssistantLeaveDialog({
  campaignId,
  onStay,
  onLeave,
}: {
  /** `null` = rien n'est enregistré : ce qui est à l'écran sera perdu. */
  campaignId: string | null;
  onStay: () => void;
  onLeave: () => void;
}) {
  const [confirme, setConfirme] = useState(false);

  if (confirme && campaignId) {
    return (
      <div style={OVERLAY} role="dialog" aria-modal="true" aria-label="Campagne enregistrée en brouillon">
        <div style={CARTE} data-dialog="leave-confirmed">
          <h2 className="font-display" style={{ fontSize: 16, fontWeight: 800, color: 'var(--dash-green)', margin: 0 }}>
            ✓ {campaignId} est enregistrée en brouillon
          </h2>
          <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)', marginTop: 8, lineHeight: 1.55 }}>
            Elle ne reçoit rien tant qu’elle n’est pas lancée. Vous la reprendrez
            quand vous voudrez, là où vous vous êtes arrêté : elle vous attend
            dans <strong>Campagnes</strong>, filtre « Brouillon », avec le bouton
            « Continuer la création ».
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" data-role="leave-done" onClick={onLeave} className="font-display" style={PRIMAIRE}>
              Très bien
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY} role="dialog" aria-modal="true" aria-label="Quitter la création">
      <div style={CARTE} data-dialog="leave-ask">
        <h2 className="font-display" style={{ fontSize: 16, fontWeight: 800, color: 'var(--dash-text)', margin: 0 }}>
          Quitter la création ?
        </h2>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)', marginTop: 8, lineHeight: 1.55 }}>
          {campaignId ? (
            <>
              La campagne <strong>{campaignId}</strong> reste enregistrée en
              brouillon : rien n’est perdu, et rien n’est lancé.
            </>
          ) : (
            <>
              Vous n’avez pas encore passé la première étape :{' '}
              <strong>ce qui est à l’écran ne sera pas conservé</strong>.
            </>
          )}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" data-role="leave-cancel" onClick={onStay} className="font-body" style={SECONDAIRE}>
            Continuer la création
          </button>
          <button
            type="button"
            data-role="leave-confirm"
            onClick={() => (campaignId ? setConfirme(true) : onLeave())}
            className="font-display"
            style={PRIMAIRE}
          >
            {campaignId ? 'Quitter, garder le brouillon' : 'Quitter sans garder'}
          </button>
        </div>
      </div>
    </div>
  );
}
