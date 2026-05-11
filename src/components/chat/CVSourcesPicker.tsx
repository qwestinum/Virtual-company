'use client';

import {
  FolderOpen,
  Globe,
  Inbox,
  Newspaper,
  Paperclip,
  Sparkles,
  Target,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  CV_SOURCE_HINTS,
  CV_SOURCE_LABELS,
  CV_SOURCE_OPERATIONAL,
  CV_SOURCES,
  type CVSource,
} from '@/types/cv-source';

export type CVSourcesPickerProps = {
  campaignId: string;
  activeSources: Record<CVSource, boolean>;
  disabled?: boolean;
  onToggle: (source: CVSource) => void;
};

const SOURCE_ICONS: Record<CVSource, typeof Globe> = {
  manual: Paperclip,
  email: Inbox,
  local_folder: FolderOpen,
  linkedin: Sparkles,
  indeed: Newspaper,
  welcome_to_the_jungle: Sparkles,
  apec: Target,
  france_travail: Globe,
  generic: Globe,
};

/**
 * Multi-toggle des flux de réception de CV pour une campagne. Les
 * sources des channels choisis pour les annonces sont activées par
 * défaut (cf. buildDefaultSourcesConfig). En Session 4, seul `manual`
 * est opérationnel — les autres sont préparées pour le futur Publisher.
 */
export function CVSourcesPicker({
  campaignId,
  activeSources,
  disabled = false,
  onToggle,
}: CVSourcesPickerProps) {
  return (
    <div className="mt-2 grid gap-1.5">
      <p className="font-body text-[11px] text-stone-500 mb-1">
        Flux de réception pour {campaignId}. Activez les sources
        souhaitées — l'upload manuel est toujours disponible.
      </p>
      {CV_SOURCES.map((source) => {
        const Icon = SOURCE_ICONS[source];
        const isActive = activeSources[source] ?? false;
        const isOperational = CV_SOURCE_OPERATIONAL[source];
        const clickable = !disabled;
        return (
          <button
            key={source}
            type="button"
            aria-pressed={isActive}
            disabled={!clickable}
            onClick={() => clickable && onToggle(source)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              !disabled
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isActive && 'border-emerald-400 bg-emerald-50',
            )}
          >
            <span
              className={cn(
                'h-8 w-8 grid place-items-center rounded-lg shrink-0',
                isActive
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-stone-100 text-stone-700 group-hover:bg-stone-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900 flex items-center gap-2">
                {CV_SOURCE_LABELS[source]}
                {!isOperational ? (
                  <span className="font-display text-[9px] uppercase tracking-[0.12em] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                    Bientôt
                  </span>
                ) : null}
              </span>
              <span className="font-body text-[11.5px] text-stone-500 block leading-snug">
                {CV_SOURCE_HINTS[source]}
              </span>
            </span>
            <ToggleVisual active={isActive} />
          </button>
        );
      })}
    </div>
  );
}

function ToggleVisual({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'h-5 w-9 rounded-full p-0.5 transition-colors shrink-0',
        active ? 'bg-emerald-500' : 'bg-stone-300',
      )}
      aria-hidden
    >
      <span
        className={cn(
          'block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          active ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </span>
  );
}
