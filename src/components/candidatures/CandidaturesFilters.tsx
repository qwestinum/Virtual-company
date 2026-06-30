'use client';

/**
 * Barre de filtres transversaux (menu Candidatures), identité ORQA.
 * Recherche · campagne (avec « Campagnes actives (N) ») · période · segment
 * d'origine (Toutes / Issues du vivier). Présentationnel : l'état + la
 * résolution des valeurs vivent dans le conteneur.
 */

export type PeriodKey = 'all' | '7' | '30';

const SELECT_CLASS =
  'h-10 rounded-[10px] border border-orqa-ligne bg-white px-3.5 font-inter text-[13.5px] text-orqa-encre cursor-pointer transition hover:border-orqa-ciel focus:border-orqa-ciel focus:outline-none focus:ring-2 focus:ring-orqa-ciel/20';

export function CandidaturesFilters({
  campaignOptions,
  activeCount,
  campaignValue,
  onCampaign,
  search,
  onSearch,
  period,
  onPeriod,
  fromVivier,
  onVivier,
}: {
  campaignOptions: { id: string; label: string }[];
  activeCount: number;
  campaignValue: string;
  onCampaign: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  period: PeriodKey;
  onPeriod: (value: PeriodKey) => void;
  fromVivier: boolean;
  onVivier: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.currentTarget.value)}
        placeholder="Rechercher un candidat…"
        className="h-10 min-w-[200px] max-w-[280px] flex-1 rounded-[10px] border border-orqa-ligne bg-white px-3.5 font-inter text-[13.5px] text-orqa-encre transition focus:border-orqa-ciel focus:outline-none focus:ring-2 focus:ring-orqa-ciel/20"
      />

      <select
        value={campaignValue}
        onChange={(e) => onCampaign(e.currentTarget.value)}
        className={SELECT_CLASS}
      >
        <option value="all">Toutes les campagnes</option>
        {activeCount > 0 ? (
          <option value="active">Campagnes actives ({activeCount})</option>
        ) : null}
        {campaignOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        value={period}
        onChange={(e) => onPeriod(e.currentTarget.value as PeriodKey)}
        className={SELECT_CLASS}
      >
        <option value="all">Depuis toujours</option>
        <option value="7">7 derniers jours</option>
        <option value="30">30 derniers jours</option>
      </select>

      <div className="ml-auto flex gap-1.5">
        <Segment active={!fromVivier} onClick={() => onVivier(false)}>
          Toutes
        </Segment>
        <Segment active={fromVivier} onClick={() => onVivier(true)}>
          ★ Issues du vivier
        </Segment>
      </div>
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-2 font-inter text-[12.5px] transition ${
        active
          ? 'border-orqa-nuit bg-orqa-nuit text-white'
          : 'border-orqa-ligne bg-white text-orqa-gris hover:border-orqa-ciel hover:text-orqa-encre'
      }`}
    >
      {children}
    </button>
  );
}
