'use client';

/**
 * Compteurs-filtres d'une carte campagne : « Reçues » en tête, puis deux
 * rangées de cinq — « en cours » et « issues » (arbitrage du 28/09/2026).
 * Les dix étapes font « Reçues » : un tableau dont les chiffres se recoupent
 * est un tableau qu'on croit. Même tuile, même taille partout ; une rangée
 * trop large passe à la ligne, elle ne rétrécit jamais ses tuiles.
 */

import { buildCardCounters, type CardCounter } from '@/lib/campagnes/card-detail';
import type { CandidateStageCounts } from '@/lib/reporting/candidate-stage';

import { CampaignStatTile } from './CampaignStatTile';

const RANGEE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
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
  const rows = buildCardCounters(campaignId, received, counts);
  return (
    <div className="flex flex-col gap-3" data-role="campaign-card-counters">
      <div style={RANGEE}>
        <Tile c={rows.recues} />
      </div>
      <Rangee titre="En cours" tuiles={rows.enCours} />
      <Rangee titre="Issues" tuiles={rows.issues} />
    </div>
  );
}

function Rangee({ titre, tuiles }: { titre: string; tuiles: CardCounter[] }) {
  return (
    <section aria-label={titre} className="flex flex-col gap-1.5">
      <h5 className="font-body text-[11px] font-semibold uppercase tracking-wide text-dash-text-secondary">
        {titre}
      </h5>
      <div style={RANGEE}>
        {tuiles.map((c) => (
          <Tile key={c.key} c={c} />
        ))}
      </div>
    </section>
  );
}

function Tile({ c }: { c: CardCounter }) {
  return (
    <CampaignStatTile
      icon={c.icon}
      color={c.color}
      value={c.count}
      label={c.label}
      hint={c.definition}
      href={c.href}
    />
  );
}
