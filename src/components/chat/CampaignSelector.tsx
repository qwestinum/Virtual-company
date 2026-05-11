'use client';

import { Menu } from '@base-ui/react/menu';
import {
  Briefcase,
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  Plus,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FDPInProgress } from '@/types/field-collection';

/**
 * Représentation visuelle d'une campagne (active ou archivée) pour le
 * sélecteur. La courante est marquée `isCurrent: true` et apparaît en
 * tête du menu, désactivée au clic (déjà sélectionnée).
 *
 * Le statut est dérivé de la FDP :
 *   - validée  : isValidated === true (vert)
 *   - draft    : isValidated === false (amber)
 */
export type CampaignEntry = {
  id: string;
  title: string;
  status: 'draft' | 'validated';
  isCurrent: boolean;
  /**
   * Snapshot complet de la FDP — fourni pour les entries archivées
   * uniquement (pour restoreFDP au clic). null pour la courante (déjà
   * dans fdp-store).
   */
  snapshot: FDPInProgress | null;
};

export type CampaignSelectorProps = {
  campaigns: CampaignEntry[];
  onSelectCampaign: (entry: CampaignEntry) => void;
  onNewCampaign: () => void;
  disabled?: boolean;
};

export function CampaignSelector({
  campaigns,
  onSelectCampaign,
  onNewCampaign,
  disabled = false,
}: CampaignSelectorProps) {
  const current = campaigns.find((c) => c.isCurrent);
  if (!current) return null;

  const isTask = current.id.startsWith('TASK-');
  const Icon = isTask ? FileText : Briefcase;
  const kind = isTask ? 'Sollicitation' : 'Campagne';
  const archived = campaigns.filter((c) => !c.isCurrent);

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
            {kind}
          </span>
          <span className="font-body text-[12px] truncate">
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
          </span>
        </div>
        <StatusDot status={current.status} />
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
              <CampaignMenuItem
                entry={current}
                onSelect={() => {}}
                isCurrent
              />
              {archived.length > 0 ? (
                <>
                  <div className="my-1 mx-3 h-px bg-stone-100" aria-hidden />
                  {archived.map((entry) => (
                    <CampaignMenuItem
                      key={entry.id}
                      entry={entry}
                      onSelect={() => onSelectCampaign(entry)}
                    />
                  ))}
                </>
              ) : null}
            </div>
            <div className="border-t border-stone-100">
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
  isCurrent = false,
}: {
  entry: CampaignEntry;
  onSelect: () => void;
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
            className={cn(
              'h-3.5 w-3.5 rounded-full border block',
              entry.status === 'validated'
                ? 'border-emerald-400'
                : 'border-amber-400',
            )}
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
            <Check
              className="h-3 w-3 text-stone-500 ml-auto shrink-0"
              aria-hidden
            />
          ) : null}
        </div>
        <p className="font-body text-[12px] text-stone-700 truncate">
          {entry.title}
        </p>
      </div>
    </Menu.Item>
  );
}

function StatusDot({ status }: { status: 'draft' | 'validated' }) {
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full shrink-0',
        status === 'validated' ? 'bg-emerald-500' : 'bg-amber-400',
      )}
      aria-hidden
      title={status === 'validated' ? 'Validée' : 'En cours'}
    />
  );
}

function StatusBadge({ status }: { status: 'draft' | 'validated' }) {
  return (
    <span
      className={cn(
        'font-display text-[9px] uppercase tracking-[0.12em] font-medium',
        'px-1.5 py-0.5 rounded',
        status === 'validated'
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700',
      )}
    >
      {status === 'validated' ? 'Validée' : 'Draft'}
    </span>
  );
}
