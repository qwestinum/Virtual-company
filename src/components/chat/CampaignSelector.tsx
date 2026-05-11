'use client';

import { Menu } from '@base-ui/react/menu';
import {
  Briefcase,
  Check,
  ChevronDown,
  CircleDot,
  CircleSlash,
  FileText,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignStatus,
} from '@/types/campaign-status';
import type { FDPInProgress } from '@/types/field-collection';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';

/**
 * Représentation visuelle d'une entrée (campagne FDP ou tâche isolée)
 * dans le sélecteur. La courante est marquée `isCurrent: true` et
 * apparaît en tête du menu, désactivée au clic.
 *
 * Phase 5.1 — le `status` reflète maintenant les 4 états canoniques
 * (draft / in_progress / active / closed) avec badge coloré.
 *
 * Le `kind` discrimine FDP (campagne, 8 champs) vs isolated (tâche,
 * 4 critères) — le handler de switch côté ManagerChat appelle
 * restoreFDP ou restoreCollection selon ce flag.
 */
export type CampaignEntry =
  | {
      kind: 'fdp';
      id: string;
      title: string;
      status: CampaignStatus;
      isCurrent: boolean;
      snapshot: FDPInProgress | null;
    }
  | {
      kind: 'isolated';
      id: string;
      title: string;
      status: CampaignStatus;
      isCurrent: boolean;
      snapshot: IsolatedCriteriaInProgress | null;
    };

export type CampaignSelectorProps = {
  campaigns: CampaignEntry[];
  onSelectCampaign: (entry: CampaignEntry) => void;
  onNewCampaign: () => void;
  /**
   * Phase 5.3 — bascule l'état d'une entrée vers `closed` (clôture)
   * ou vers le status précédent (réouverture). Le sélecteur n'a pas
   * besoin de connaître la transition exacte : ManagerChat la gère.
   */
  onChangeStatus?: (entry: CampaignEntry, next: CampaignStatus) => void;
  disabled?: boolean;
};

export function CampaignSelector({
  campaigns,
  onSelectCampaign,
  onNewCampaign,
  onChangeStatus,
  disabled = false,
}: CampaignSelectorProps) {
  const current = campaigns.find((c) => c.isCurrent) ?? null;
  // Les campagnes clôturées sont écartées du menu déroulant — elles
  // ne sont plus une option de reprise pour le DRH. Exception : si
  // la campagne courante est elle-même clôturée (le DRH y est resté
  // après clôture), elle reste affichée en tête avec son action
  // « Rouvrir » accessible. Pas de section archives — pour récupérer
  // une campagne clôturée, on passe par la console Supabase.
  const archived = campaigns.filter(
    (c) => !c.isCurrent && c.status !== 'closed',
  );
  // Bandeau visible dès qu'il y a au moins une campagne dans n'importe
  // quel état (sinon le DRH n'a pas accès au CTA « Nouvelle campagne »).
  if (campaigns.length === 0) return null;

  const isTask = current ? current.id.startsWith('TASK-') : false;
  const Icon = current ? (isTask ? FileText : Briefcase) : Briefcase;
  const kind = current ? (isTask ? 'Sollicitation' : 'Campagne') : 'Campagne';

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        className={cn(
          'group w-full flex items-center gap-2.5 px-4 py-2.5 border-b',
          'transition-colors text-left',
          isTask
            ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
            : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
          disabled && 'opacity-60 cursor-not-allowed hover:bg-transparent',
        )}
      >
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            isTask ? 'text-amber-700' : 'text-indigo-700',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex flex-col leading-tight flex-1">
          <span
            className={cn(
              'font-display text-[10px] uppercase tracking-[0.18em] font-semibold',
              isTask ? 'text-amber-700' : 'text-indigo-700',
            )}
          >
            {current ? kind : 'Campagnes'}
          </span>
          <span className="font-body text-[12px] truncate">
            {current ? (
              <>
                <span
                  className={cn(
                    'font-data font-semibold tracking-tight',
                    isTask ? 'text-amber-900' : 'text-indigo-900',
                  )}
                >
                  {current.id}
                </span>
                <span
                  className={cn(
                    'font-normal',
                    isTask ? 'text-amber-700/80' : 'text-indigo-700/80',
                  )}
                >
                  {' '}
                  — {current.title}
                </span>
              </>
            ) : (
              <span
                className={cn(
                  'font-normal italic',
                  isTask ? 'text-amber-700/80' : 'text-indigo-700/80',
                )}
              >
                {archived.length === 0
                  ? 'Démarrer une nouvelle campagne'
                  : archived.length === 1
                    ? 'Reprendre la campagne archivée ou en démarrer une nouvelle'
                    : `Reprendre une des ${archived.length} campagnes archivées ou en démarrer une nouvelle`}
              </span>
            )}
          </span>
        </div>
        {current ? <StatusDot status={current.status} /> : null}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            'text-stone-500 group-data-[popup-open]:rotate-180',
          )}
          aria-hidden
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="z-50 outline-none"
          sideOffset={4}
          align="start"
        >
          <Menu.Popup
            className={cn(
              'min-w-[300px] max-w-[420px] rounded-lg border border-stone-200',
              'bg-white shadow-lg overflow-hidden text-sm',
              'origin-[var(--transform-origin)] transition-all duration-100',
              'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            )}
          >
            <div className="px-3 py-2 border-b border-stone-100 bg-stone-50/60">
              <p className="font-display text-[10px] uppercase tracking-[0.16em] text-stone-500 font-semibold">
                Campagnes
              </p>
            </div>
            <div className="py-1 max-h-[300px] overflow-y-auto">
              {current ? (
                <CampaignMenuItem
                  entry={current}
                  onSelect={() => {}}
                  onChangeStatus={onChangeStatus}
                  isCurrent
                />
              ) : null}
              {current && archived.length > 0 ? (
                <div className="my-1 mx-3 h-px bg-stone-100" aria-hidden />
              ) : null}
              {archived.length > 0
                ? archived.map((entry) => (
                    <CampaignMenuItem
                      key={entry.id}
                      entry={entry}
                      onSelect={() => onSelectCampaign(entry)}
                      onChangeStatus={onChangeStatus}
                    />
                  ))
                : null}
              {!current && archived.length === 0 ? (
                <p className="px-3 py-2 font-body text-[12px] italic text-stone-500">
                  Aucune campagne enregistrée.
                </p>
              ) : null}
            </div>
            <div className="border-t border-stone-100">
              {current &&
              onChangeStatus &&
              current.status !== 'closed' &&
              current.status !== 'paused' ? (
                <Menu.Item
                  onClick={() => onChangeStatus(current, 'paused')}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2.5',
                    'text-yellow-700 font-medium font-body text-[12.5px]',
                    'hover:bg-yellow-50 outline-none cursor-pointer',
                    'data-[highlighted]:bg-yellow-50',
                  )}
                >
                  <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                  Suspendre la campagne
                </Menu.Item>
              ) : null}
              {current && onChangeStatus && current.status === 'paused' ? (
                <Menu.Item
                  onClick={() => onChangeStatus(current, 'in_progress')}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2.5',
                    'text-sky-700 font-medium font-body text-[12.5px]',
                    'hover:bg-sky-50 outline-none cursor-pointer',
                    'data-[highlighted]:bg-sky-50',
                  )}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Reprendre la campagne
                </Menu.Item>
              ) : null}
              {current && onChangeStatus && current.status !== 'closed' ? (
                <Menu.Item
                  onClick={() => onChangeStatus(current, 'closed')}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2.5',
                    'text-stone-600 font-medium font-body text-[12.5px]',
                    'hover:bg-stone-50 outline-none cursor-pointer',
                    'data-[highlighted]:bg-stone-50',
                  )}
                >
                  <CircleSlash className="h-3.5 w-3.5" aria-hidden />
                  Marquer comme terminée
                </Menu.Item>
              ) : null}
              {current && onChangeStatus && current.status === 'closed' ? (
                <Menu.Item
                  onClick={() => onChangeStatus(current, 'in_progress')}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2.5',
                    'text-sky-700 font-medium font-body text-[12.5px]',
                    'hover:bg-sky-50 outline-none cursor-pointer',
                    'data-[highlighted]:bg-sky-50',
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Rouvrir la campagne
                </Menu.Item>
              ) : null}
              <Menu.Item
                onClick={onNewCampaign}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-2.5',
                  'text-emerald-700 font-medium font-body text-[12.5px]',
                  'hover:bg-emerald-50 outline-none cursor-pointer',
                  'data-[highlighted]:bg-emerald-50',
                )}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Nouvelle campagne
              </Menu.Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function CampaignMenuItem({
  entry,
  onSelect,
  onChangeStatus,
  isCurrent = false,
}: {
  entry: CampaignEntry;
  onSelect: () => void;
  onChangeStatus?: (entry: CampaignEntry, next: CampaignStatus) => void;
  isCurrent?: boolean;
}) {
  const isTask = entry.id.startsWith('TASK-');
  return (
    <Menu.Item
      onClick={isCurrent ? undefined : onSelect}
      disabled={isCurrent}
      className={cn(
        'flex items-start gap-2.5 w-full px-3 py-2',
        'outline-none transition-colors',
        isCurrent
          ? 'cursor-default bg-stone-50/60'
          : 'cursor-pointer hover:bg-stone-50 data-[highlighted]:bg-stone-50',
      )}
    >
      <div className="pt-0.5 shrink-0">
        {isCurrent ? (
          <CircleDot
            className={cn(
              'h-3.5 w-3.5',
              isTask ? 'text-amber-600' : 'text-indigo-600',
            )}
            aria-hidden
          />
        ) : (
          <span
            className="h-3.5 w-3.5 rounded-full border block"
            style={{
              borderColor: CAMPAIGN_STATUS_COLORS[entry.status],
            }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={cn(
              'font-data text-[11px] font-semibold tracking-tight',
              isTask ? 'text-amber-900' : 'text-indigo-900',
            )}
          >
            {entry.id}
          </span>
          <StatusBadge status={entry.status} />
          {isCurrent ? (
            <Check className="h-3 w-3 text-stone-500 shrink-0" aria-hidden />
          ) : null}
        </div>
        <p className="font-body text-[12px] text-stone-700 truncate">
          {entry.title}
        </p>
      </div>
      {onChangeStatus ? (
        <InlineStatusActions
          entry={entry}
          onChangeStatus={onChangeStatus}
        />
      ) : null}
    </Menu.Item>
  );
}

/**
 * Phase 8 — boutons icône d'action inline sur chaque ligne du
 * sélecteur. Deux contrôles, l'un toggle paused/in_progress, l'autre
 * toggle closed/in_progress. Click stopPropagé pour ne pas déclencher
 * la sélection de la ligne parente (Menu.Item.onClick).
 *
 * Conventions :
 *   - paused: bouton Play (jaune) → "Reprendre"
 *   - non-paused, non-closed: bouton PauseCircle (jaune pâle) → "Suspendre"
 *   - closed: bouton RotateCcw (sky) → "Rouvrir"
 *   - non-closed: bouton CircleSlash (gris) → "Clôturer"
 */
function InlineStatusActions({
  entry,
  onChangeStatus,
}: {
  entry: CampaignEntry;
  onChangeStatus: (entry: CampaignEntry, next: CampaignStatus) => void;
}) {
  const isPaused = entry.status === 'paused';
  const isClosed = entry.status === 'closed';
  // Click handlers stoppent la propagation pour ne pas déclencher
  // l'onSelect du Menu.Item parent (qui ferait basculer la campagne
  // courante avant de muter le statut).
  function pauseToggle(e: React.PointerEvent | React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChangeStatus(entry, isPaused ? 'in_progress' : 'paused');
  }
  function closeToggle(e: React.PointerEvent | React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChangeStatus(entry, isClosed ? 'in_progress' : 'closed');
  }
  return (
    <div
      className="flex items-center gap-0.5 shrink-0 ml-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!isClosed ? (
        <button
          type="button"
          aria-label={isPaused ? 'Reprendre la campagne' : 'Suspendre la campagne'}
          title={isPaused ? 'Reprendre' : 'Suspendre'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={pauseToggle}
          className={cn(
            'h-6 w-6 grid place-items-center rounded',
            'transition-colors',
            isPaused
              ? 'text-sky-700 hover:bg-sky-50'
              : 'text-yellow-700 hover:bg-yellow-50',
          )}
        >
          {isPaused ? (
            <Play className="h-3 w-3" aria-hidden />
          ) : (
            <PauseCircle className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={isClosed ? 'Rouvrir la campagne' : 'Clôturer la campagne'}
        title={isClosed ? 'Rouvrir' : 'Clôturer'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeToggle}
        className={cn(
          'h-6 w-6 grid place-items-center rounded',
          'transition-colors',
          isClosed
            ? 'text-sky-700 hover:bg-sky-50'
            : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
        )}
      >
        {isClosed ? (
          <RotateCcw className="h-3 w-3" aria-hidden />
        ) : (
          <CircleSlash className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: CampaignStatus }) {
  return (
    <span
      className="h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: CAMPAIGN_STATUS_COLORS[status] }}
      aria-hidden
      title={CAMPAIGN_STATUS_LABELS[status]}
    />
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const color = CAMPAIGN_STATUS_COLORS[status];
  return (
    <span
      className="font-display text-[9px] uppercase tracking-[0.12em] font-medium px-1.5 py-0.5 rounded"
      style={{
        backgroundColor: `${color}1a`, // 10% opacity background
        color,
      }}
    >
      {CAMPAIGN_STATUS_LABELS[status]}
    </span>
  );
}
