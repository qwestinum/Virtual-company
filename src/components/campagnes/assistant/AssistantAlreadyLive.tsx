'use client';

/**
 * « Cette campagne est déjà lancée » — l'assistant refuse de la rouvrir.
 *
 * Il CRÉE ; une campagne qui tourne se règle depuis sa fiche, où l'on voit ce
 * qu'elle a déjà reçu. On ne renvoie pas en silence sur la liste : un écran qui
 * change sans un mot laisse croire à une erreur de clic.
 */

import Link from 'next/link';

export function AssistantAlreadyLive({
  campaignId,
  name,
}: {
  campaignId: string;
  name: string;
}) {
  return (
    <div
      data-already-live={campaignId}
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 12,
        padding: '26px 24px',
      }}
    >
      <h2 className="font-display" style={{ fontSize: 18, fontWeight: 800, color: 'var(--dash-text)' }}>
        {name} est déjà lancée
      </h2>
      <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)', marginTop: 6 }}>
        L’assistant sert à créer une campagne. Celle-ci tourne déjà : ses
        réglages se modifient depuis sa fiche, où vous voyez aussi ce qu’elle a
        reçu.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <Link
          href={`/campagnes?campagne=${encodeURIComponent(campaignId)}`}
          className="font-display"
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            border: 'none',
            background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
          }}
        >
          Ouvrir {campaignId}
        </Link>
        <Link
          href="/campagnes/nouvelle"
          className="font-body"
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: '1px solid var(--dash-border)',
            background: 'var(--dash-surface)',
            color: 'var(--dash-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Créer une autre campagne
        </Link>
      </div>
    </div>
  );
}
