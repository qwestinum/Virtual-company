'use client';

/**
 * Barre de filtres transversaux (menu Candidatures), identité ORQA.
 * Recherche · campagne (avec « Campagnes actives (N) ») · période · segment
 * Toutes / Issues du vivier. « Toutes » RÉINITIALISE LA VUE complète (étape,
 * recherche, période, campagne → défaut) — pas seulement le segment vivier :
 * c'est le bouton « revenir à la vue de départ ». Présentationnel : l'état +
 * la résolution des valeurs vivent dans le conteneur.
 */

export type PeriodKey = 'all' | '7' | '30';

const SELECT_CLASS =
  'h-10 rounded-[10px] border border-dash-border bg-white px-3.5 font-body text-[13.5px] text-dash-text cursor-pointer transition hover:border-dash-blue focus:border-dash-blue focus:outline-none focus:ring-2 focus:ring-dash-blue/20';

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
  everInvited,
  onClearEverInvited,
  everInterviewed,
  onClearEverInterviewed,
  onReset,
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
  /**
   * Filtres de TRAJECTOIRE actifs (posés par les quadrants d'une carte
   * campagne). Affichés en chips retirables — jamais posables depuis cette
   * barre.
   */
  everInvited?: boolean;
  onClearEverInvited?: () => void;
  everInterviewed?: boolean;
  onClearEverInterviewed?: () => void;
  /** « Toutes » : retour à la vue par défaut (tous filtres réinitialisés). */
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.currentTarget.value)}
        placeholder="Rechercher un candidat…"
        className="h-10 min-w-[200px] max-w-[280px] flex-1 rounded-[10px] border border-dash-border bg-white px-3.5 font-body text-[13.5px] text-dash-text transition focus:border-dash-blue focus:outline-none focus:ring-2 focus:ring-dash-blue/20"
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

      {everInvited ? (
        <TrajectoryChip
          onClear={onClearEverInvited}
          title="Retirer le filtre « Passés par l'invitation »"
        >
          ⭐ Passés par l&apos;invitation
        </TrajectoryChip>
      ) : null}
      {everInterviewed ? (
        <TrajectoryChip
          onClear={onClearEverInterviewed}
          title="Retirer le filtre « Passés par l'entretien »"
        >
          🎯 Passés par l&apos;entretien
        </TrajectoryChip>
      ) : null}

      <div className="ml-auto flex gap-1.5">
        <Segment active={!fromVivier} onClick={onReset}>
          Toutes
        </Segment>
        <Segment active={fromVivier} onClick={() => onVivier(true)}>
          ★ Issues du vivier
        </Segment>
      </div>
    </div>
  );
}

/** Chip retirable d'un filtre de trajectoire (posé par un quadrant campagne). */
function TrajectoryChip({
  onClear,
  title,
  children,
}: {
  onClear?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-dash-blue bg-dash-blue/10 px-3.5 py-2 font-body text-[12.5px] text-dash-text transition hover:border-dash-text"
    >
      {children}
      <span aria-hidden className="font-bold">×</span>
    </button>
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
      className={`rounded-full border px-3.5 py-2 font-body text-[12.5px] transition ${
        active
          ? 'border-dash-text bg-dash-text text-white'
          : 'border-dash-border bg-white text-dash-text-secondary hover:border-dash-blue hover:text-dash-text'
      }`}
    >
      {children}
    </button>
  );
}
