'use client';

/**
 * Compteurs-filtres d'une carte campagne : l'ENTONNOIR sur une rangée —
 * Reçues · À valider · Invité · Entretien fait · Retenu · Recruté — chaque
 * candidature PASSÉE par une étape la compte (règle du donneur d'ordre,
 * 28/09/2026), soldé par le taux de conversion. Chaque compteur ouvre
 * Candidatures sur les candidatures qu'il compte (filtre de parcours). Les six
 * tuiles occupent toute la largeur (auto-fit) ; trop étroite, la rangée passe
 * à la ligne sans jamais rétrécir ses tuiles sous 110 px.
 */

import { buildCardCounters, conversionLine } from '@/lib/campagnes/card-detail';
import type { TrajectoryCounts } from '@/lib/reporting/campaign-trajectory';

import { CampaignStatTile } from './CampaignStatTile';

const RANGEE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 12,
} as const;

export function CampaignCardStageCounters({
  campaignId,
  trajectory,
}: {
  campaignId: string;
  trajectory: TrajectoryCounts;
}) {
  const conversion = conversionLine(trajectory);
  return (
    <>
    <div style={RANGEE} data-role="campaign-card-counters">
      {buildCardCounters(campaignId, trajectory).map((c) => (
        <CampaignStatTile
          key={c.key}
          icon={c.icon}
          color={c.color}
          value={c.count}
          label={c.label}
          hint={c.definition}
          href={c.href}
        />
      ))}
    </div>
    {conversion ? (
      <p
        data-role="campaign-conversion"
        className="font-body"
        style={{ marginTop: 10, fontSize: 12.5, color: 'var(--dash-text-secondary)' }}
      >
        {conversion}
      </p>
    ) : null}
    </>
  );
}
