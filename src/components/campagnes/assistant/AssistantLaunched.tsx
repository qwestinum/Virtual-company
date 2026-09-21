'use client';

/**
 * L'écran qui suit le lancement — l'assistant se retire et rend la main.
 *
 * ⚠️ LES MÊMES CARTES QUE LA CAMPAGNE, pas des copies : `useCampaignCardSources`
 * pour les états, `buildCardSources` pour les libellés et les adresses,
 * `CampaignSourceTile` pour le rendu. Trois portes refaites à l'identique ici
 * auraient divergé de celles de la carte au premier changement — et la
 * divergence serait muette : le recruteur verrait deux états différents pour
 * le même vivier selon l'écran d'où il regarde.
 */

import Link from 'next/link';

import { buildCardSources } from '@/lib/campagnes/card-detail';

import {
  CampaignSourceTile,
  CampaignSourceTileSkeleton,
} from '../CampaignStatTile';
import { useCampaignCardSources } from '../useCampaignCardDetail';

export function AssistantLaunched({
  campaignId,
  name,
  notice,
}: {
  campaignId: string;
  name: string;
  notice: string | null;
}) {
  const sources = useCampaignCardSources(campaignId, true);

  return (
    <div
      data-launched={campaignId}
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '26px 24px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span aria-hidden style={{ fontSize: 20 }}>
            🎉
          </span>
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 800, color: 'var(--dash-text)' }}>
            {name} est lancée
          </h2>
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
            {campaignId}
          </span>
        </div>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)', marginTop: 6 }}>
          Elle reçoit les candidatures. Voici par où les faire venir.
        </p>

        {/* Un avertissement n'annule pas le lancement — mais il se DIT. */}
        {notice ? (
          <p
            role="alert"
            className="font-body"
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--dash-orange-light)',
              color: 'var(--dash-orange)',
              fontSize: 12,
            }}
          >
            {notice}
          </p>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            marginTop: 18,
          }}
        >
          {sources.kind === 'ready' ? (
            buildCardSources(campaignId, sources.data).map((s) => (
              <CampaignSourceTile
                key={s.key}
                icon={s.icon}
                color={s.color}
                label={s.label}
                state={s.state}
                href={s.href}
                reason={s.reason}
              />
            ))
          ) : sources.kind === 'error' ? (
            <p
              className="font-body"
              style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--dash-text-secondary)' }}
            >
              Ces informations n’ont pas pu être chargées. La campagne, elle, est bien lancée.
            </p>
          ) : (
            <>
              <CampaignSourceTileSkeleton />
              <CampaignSourceTileSkeleton />
              <CampaignSourceTileSkeleton />
            </>
          )}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '14px 22px',
          borderTop: '1px solid var(--dash-border)',
          background: 'var(--dash-warm)',
        }}
      >
        <Link
          href={`/campagnes?campagne=${encodeURIComponent(campaignId)}`}
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
          Voir la campagne
        </Link>
      </div>
    </div>
  );
}
