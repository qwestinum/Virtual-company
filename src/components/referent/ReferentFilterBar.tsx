'use client';

/**
 * LA barre de filtres de campagne — référent (Tous · Mes campagnes), puis,
 * sur les écrans qui le portent, l'ÉTAT de campagne (Actives · Suspendues ·
 * Brouillons · Clôturées · Toutes), et le libellé de ce qui est filtré
 * (« Mes campagnes · actives (7) »). UNE rangée, deux filtres CUMULÉS
 * (fix/vivier-replanif-filtres, point 3) — composant unique, jamais recopié.
 *
 * COMMODITÉ DE LECTURE, jamais une restriction d'accès : tout reste
 * consultable et actionnable par tout le monde, le filtre ne fait que réduire
 * ce qui s'affiche. Les deux états sont MÉMORISÉS par recruteur et partagés
 * entre écrans (`useReferentFilter`, `useCampaignStateFilter`) ; ce qui
 * contient le risque d'un filtre oublié, c'est que la barre est visible sur
 * chaque écran qui l'applique, avec le libellé de ce qu'elle filtre.
 *
 * Le sélecteur est un `<select>` natif, comme le sélecteur « Recruteur
 * référent » de l'édition de campagne (cf. OwnerEditBlock) : même idiome,
 * accessible au clavier sans code.
 */

import {
  Toolbar,
  ToolbarReset,
  ToolbarSegment,
  ToolbarSelect,
} from '@/components/ui/Toolbar';
import {
  CAMPAIGN_STATE_FILTERS,
  CAMPAIGN_STATE_LABELS,
  DEFAULT_CAMPAIGN_STATE,
  type CampaignStateFilter,
} from '@/lib/referent/campaign-state';
import {
  ALL_REFERENTS,
  referentSelectionKey,
  type ReferentOption,
  type ReferentSelection,
} from '@/lib/referent/filter';

export function ReferentFilterBar({
  options,
  selection,
  onChange,
  myCount,
  currentUserId,
  state,
  result,
}: {
  options: ReferentOption[];
  selection: ReferentSelection;
  onChange: (next: ReferentSelection) => void;
  /** Dossiers dont le référent est l'utilisateur connecté. 0 ⇒ pas de raccourci. */
  myCount: number;
  currentUserId: string | null;
  /** État de campagne — seulement sur les écrans qui le filtrent. */
  state?: {
    value: CampaignStateFilter;
    onChange: (next: CampaignStateFilter) => void;
  };
  /** Ce qui est filtré, en clair (« Mes campagnes · actives (7) »). */
  result?: string;
}) {
  const showReferent = options.length > 1;
  // Rien à filtrer (personne n'a de référent, pas d'état) : la barre se
  // retire plutôt que d'occuper la page pour rien.
  if (!showReferent && !state && !result) return null;

  const selectedKey = referentSelectionKey(selection);
  const isMine =
    selection.kind === 'recruiter' && selection.id === currentUserId;
  const isFiltered =
    selection.kind !== 'all' ||
    (state !== undefined && state.value !== DEFAULT_CAMPAIGN_STATE);

  return (
    // ⚠️ LA BARRE D'OUTILS PARTAGÉE : une seule rangée, des contrôles de même
    // hauteur. Le sélecteur et le raccourci vivaient côte à côte avec deux
    // hauteurs différentes — ce qui se lit comme deux rangées.
    <Toolbar>
      {showReferent ? (
        <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
          Référent :
          <ToolbarSelect
            ariaLabel="Filtrer par référent"
            testId="referent"
            value={selectedKey}
            onChange={(v) => {
              const next = options.find(
                (o) => referentSelectionKey(o.selection) === v,
              );
              onChange(next?.selection ?? ALL_REFERENTS);
            }}
          >
            {options.map((o) => (
              <option
                key={referentSelectionKey(o.selection)}
                value={referentSelectionKey(o.selection)}
              >
                {o.label} ({o.count})
              </option>
            ))}
          </ToolbarSelect>
        </label>
      ) : null}

      {showReferent && currentUserId && myCount > 0 ? (
        <ToolbarSegment
          active={isMine}
          onClick={() =>
            onChange(
              isMine ? ALL_REFERENTS : { kind: 'recruiter', id: currentUserId },
            )
          }
        >
          Mes campagnes ({myCount})
        </ToolbarSegment>
      ) : null}

      {state ? (
        <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
          État :
          <ToolbarSelect
            ariaLabel="Filtrer par état de campagne"
            testId="campaign-state"
            value={state.value}
            onChange={(v) => state.onChange(v as CampaignStateFilter)}
          >
            {CAMPAIGN_STATE_FILTERS.map((f) => (
              <option key={f} value={f}>
                {CAMPAIGN_STATE_LABELS[f]}
              </option>
            ))}
          </ToolbarSelect>
        </label>
      ) : null}

      {result ? (
        <span
          data-role="filter-result"
          className="font-body text-[12.5px] text-stone-600"
        >
          {result}
        </span>
      ) : null}

      {isFiltered ? (
        <ToolbarReset
          onClick={() => {
            onChange(ALL_REFERENTS);
            state?.onChange(DEFAULT_CAMPAIGN_STATE);
          }}
        />
      ) : null}
    </Toolbar>
  );
}
