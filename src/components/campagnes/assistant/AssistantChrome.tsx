'use client';

/**
 * L'habillage de l'assistant : en-tête, bande d'enregistrement, corps.
 *
 * ⚠️ LA BANDE D'ENREGISTREMENT CHANGE DE CAMP, et c'est elle qui rend le
 * « fermez, vous reprendrez ici » crédible sans qu'on ait à l'expliquer. Avant
 * la première étape validée, elle dit que RIEN n'est enregistré ; après, elle
 * nomme le brouillon. Un assistant qui enregistre en silence laisse croire
 * qu'on perd tout en fermant.
 */

import type { CSSProperties, ReactNode } from 'react';

export const SECONDAIRE: CSSProperties = {
  padding: '9px 16px',
  borderRadius: 8,
  border: '1px solid var(--dash-border)',
  background: 'var(--dash-surface)',
  color: 'var(--dash-text-secondary)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

/**
 * ⚠️ Le titre CHANGE dès que le brouillon existe : « Nouvelle campagne »
 * devient l'intitulé du poste, avec sa référence à côté. Garder un titre
 * générique après l'enregistrement, c'est laisser le recruteur sans repère
 * quand il revient sur trois brouillons ouverts — et l'intitulé est
 * précisément ce qu'il vient de saisir.
 */
export function AssistantHeader({
  onClose,
  titre,
  reference,
}: {
  onClose: () => void;
  titre: string | null;
  reference: string | null;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '18px 22px 14px',
      }}
    >
      <div>
        <h1
          className="font-display"
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--dash-text)',
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {titre ?? 'Nouvelle campagne'}
          {reference ? (
            <span
              className="font-data"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--dash-text-secondary)',
                background: 'var(--dash-warm)',
                border: '1px solid var(--dash-border)',
                borderRadius: 999,
                padding: '2px 9px',
              }}
            >
              {reference}
            </span>
          ) : null}
        </h1>
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginTop: 3 }}>
          Six étapes. Vous pouvez vous arrêter à tout moment et reprendre plus tard.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="font-body"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Fermer
      </button>
    </header>
  );
}

export function AssistantSaveBar({ campaignId }: { campaignId: string | null }) {
  return (
    <div
      data-saved={campaignId ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 22px',
        borderBottom: '1px solid var(--dash-border)',
        background: campaignId ? 'var(--dash-green-light)' : 'var(--dash-surface)',
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>
        {campaignId ? '💾' : '○'}
      </span>
      <span
        className="font-body"
        style={{ fontSize: 12, color: campaignId ? 'var(--dash-green)' : 'var(--dash-text-secondary)' }}
      >
        {campaignId ? (
          <>
            Brouillon enregistré — <strong>{campaignId}</strong>. Vous pouvez fermer :
            vous reprendrez ici.
          </>
        ) : (
          <>Rien n’est encore enregistré. Ça le sera dès que vous passerez à la suite.</>
        )}
      </span>
    </div>
  );
}

export function AssistantBody({
  titre,
  sousTitre,
  children,
}: {
  titre: string;
  sousTitre: string;
  children: ReactNode;
}) {
  return (
    <div style={{ padding: '22px 22px 24px' }}>
      <h2 className="font-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--dash-text)' }}>
        {titre}
      </h2>
      <p
        className="font-body"
        style={{ fontSize: 13, color: 'var(--dash-text-secondary)', marginTop: 4, marginBottom: 18 }}
      >
        {sousTitre}
      </p>
      {children}
    </div>
  );
}
