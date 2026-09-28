'use client';

/**
 * Compteurs-filtres d'une carte campagne : le FUNNEL POSITIF sur une rangée —
 * Reçues · À valider · Invité · Entretien fait · Retenu · Recruté (arbitrage
 * du 28/09/2026). Les issues négatives et les étapes intermédiaires se lisent
 * dans Candidatures et Pilotage. Chaque compteur mène à la puce du même mot ;
 * les six tuiles occupent toute la largeur (auto-fit : aucune colonne vide
 * en bout de rangée) ; trop étroite, la rangée passe à la ligne sans jamais
 * rétrécir ses tuiles sous 110 px.
 */

import { buildCardCounters } from '@/lib/campagnes/card-detail';
import type { CandidateStageCounts } from '@/lib/reporting/candidate-stage';

import { CampaignStatTile } from './CampaignStatTile';

const RANGEE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 12,
} as const;

export function CampaignCardStageCounters({
  campaignId,
  received,
  counts,
}: {
  campaignId: string;
  received: number;
  counts: CandidateStageCounts;
}) {
  return (
    <div style={RANGEE} data-role="campaign-card-counters">
      {buildCardCounters(campaignId, received, counts).map((c) => (
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
  );
}
