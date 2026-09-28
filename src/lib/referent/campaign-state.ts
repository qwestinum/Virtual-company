/**
 * Filtre d'ÉTAT de campagne — règles PURES, partagées par tous les écrans
 * (fix/vivier-replanif-filtres, point 3). CLIENT-SAFE.
 *
 * Il se CUMULE au filtre référent, par construction : « Mes campagnes » ∧
 * « Actives » = mes campagnes actives. Une seule barre les porte, dans cet
 * ordre, et le libellé de résultat dit ce qui est filtré.
 *
 * Lecture TOLÉRANTE de la préférence : une valeur inconnue retombe sur
 * « Actives », le défaut historique de Campagnes et de Candidatures.
 */

import type { CampaignStatus } from '@/types/campaign-status';

import {
  activeReferentOf,
  matchesReferentBy,
  type ReferentByCampaign,
  type ReferentSelection,
} from './filter';

export const CAMPAIGN_STATE_FILTERS = ['active', 'paused', 'draft', 'closed', 'all'] as const;
export type CampaignStateFilter = (typeof CAMPAIGN_STATE_FILTERS)[number];

export const DEFAULT_CAMPAIGN_STATE: CampaignStateFilter = 'active';

/** Libellés d'écran (liste du donneur d'ordre). */
export const CAMPAIGN_STATE_LABELS: Record<CampaignStateFilter, string> = {
  active: 'Actives',
  paused: 'Suspendues',
  draft: 'Brouillons',
  closed: 'Clôturées',
  all: 'Toutes',
};

/** `draft` agrège `in_progress` (cadrage en cours) — comme la liste des campagnes. */
export function matchesCampaignState(
  status: CampaignStatus | null | undefined,
  filter: CampaignStateFilter,
): boolean {
  if (filter === 'all') return true;
  if (!status) return false;
  if (filter === 'draft') return status === 'draft' || status === 'in_progress';
  return status === filter;
}

export function parseCampaignState(raw: string | null | undefined): CampaignStateFilter {
  return (CAMPAIGN_STATE_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as CampaignStateFilter)
    : DEFAULT_CAMPAIGN_STATE;
}

/**
 * Le libellé de résultat : « Mes campagnes · actives (7 campagnes) »,
 * « Toutes les campagnes · toutes (23 campagnes) », « Mes campagnes · actives
 * (4 entretiens) » sur Entretiens.
 */
export function campaignFilterResultLabel(args: {
  selection: ReferentSelection;
  currentUserId: string | null;
  /** Nom affiché du référent choisi (sélecteur). */
  referentLabel?: string | null;
  state: CampaignStateFilter;
  count: number;
  /** Ce qui est compté — « campagne » par défaut ; accordé au pluriel. */
  unit?: { one: string; many: string };
}): string {
  const { selection } = args;
  const perimetre =
    selection.kind === 'all'
      ? 'Toutes les campagnes'
      : selection.kind === 'none'
        ? 'Sans référent'
        : selection.id === args.currentUserId
          ? 'Mes campagnes'
          : `Campagnes de ${args.referentLabel ?? 'ce référent'}`;
  const unit = args.unit ?? { one: 'campagne', many: 'campagnes' };
  return `${perimetre} · ${CAMPAIGN_STATE_LABELS[args.state].toLowerCase()} (${args.count} ${args.count > 1 ? unit.many : unit.one})`;
}

/**
 * Campagnes retenues par les DEUX filtres (référent ∧ état), dans l'ordre
 * reçu — la même règle pour le libellé de résultat et pour ce que chaque
 * écran restreint.
 */
export function campaignsMatchingFilters<C extends { id: string; status: CampaignStatus }>(
  campaigns: readonly C[],
  referentByCampaign: ReferentByCampaign,
  selection: ReferentSelection,
  state: CampaignStateFilter,
): C[] {
  return campaigns.filter(
    (c) =>
      matchesCampaignState(c.status, state) &&
      matchesReferentBy(c, (x) => activeReferentOf(x.id, referentByCampaign), selection),
  );
}
