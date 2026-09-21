'use client';

/**
 * UN GESTE, UN ÉCRAN — la coquille des portes d'une campagne.
 *
 * « Diffuser l'annonce » et « Chercher dans le vivier » ouvraient la feuille
 * d'édition latérale, sur un accordéon de neuf blocs dont un seul était
 * demandé : on arrivait devant un formulaire complet pour écrire un texte, ou
 * pour trancher trois profils. Ici, le geste nommé occupe l'écran, et rien
 * d'autre.
 *
 * ⚠️ UNE ADRESSE, pas une fenêtre : `/campagnes/<id>/annonce` se partage, se
 * recharge, revient par le bouton Précédent, et un signal peut y pointer. Une
 * surimpression aurait le même rendu et aucune de ces quatre propriétés — et
 * c'est exactement ce que la refonte est venue réparer.
 *
 * « Fermer » ramène à la campagne, jamais à la liste nue : on repart d'où l'on
 * vient.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useCampaignsStore } from '@/stores/campaigns-store';

export function CampaignFocusScreen({
  campaignId,
  titre,
  sousTitre,
  children,
}: {
  campaignId: string;
  titre: string;
  sousTitre: string;
  children: (campaign: NonNullable<ReturnType<typeof useCampaignsStore.getState>['byId'][string]>) => ReactNode;
}) {
  const campaign = useCampaignsStore((s) => s.byId[campaignId] ?? null);
  const charge = useCampaignsStore((s) => s.order.length > 0);

  return (
    <div
      className="font-body"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'transparent',
        color: 'var(--dash-text)',
      }}
    >
      <div style={{ padding: '24px 28px 260px', maxWidth: 980, margin: '0 auto' }}>
        <div
          data-focus={campaignId}
          style={{
            background: 'var(--dash-surface)',
            border: '1px solid var(--dash-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              padding: '18px 22px 16px',
              borderBottom: '1px solid var(--dash-border)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1
                className="font-display"
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  color: 'var(--dash-text)',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                {titre}
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
                  {campaign?.name ?? campaignId}
                </span>
              </h1>
              <p
                className="font-body"
                style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)', marginTop: 4 }}
              >
                {sousTitre}
              </p>
            </div>
            <Link
              href={`/campagnes?campagne=${encodeURIComponent(campaignId)}`}
              className="font-body"
              style={{
                fontSize: 12,
                color: 'var(--dash-text-secondary)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                whiteSpace: 'nowrap',
              }}
            >
              Fermer
            </Link>
          </header>

          <div style={{ padding: '20px 22px 24px' }}>
            {campaign ? (
              children(campaign)
            ) : charge ? (
              // La campagne n'existe pas (adresse tapée de travers, campagne
              // effacée) : on le DIT, on ne rend pas un écran vide.
              <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}>
                Cette campagne est introuvable. Elle a peut-être été supprimée —{' '}
                <Link href="/campagnes" style={{ color: 'var(--dash-blue)' }}>
                  revenir à la liste
                </Link>
                .
              </p>
            ) : (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}>
                Chargement…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
