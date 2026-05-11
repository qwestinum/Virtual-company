'use client';

import { Check, Globe, Newspaper, Sparkles, Target } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';

export type PublicationChannelPickerProps = {
  campaignId: string;
  selectedChannels: PublicationChannel[];
  confirmed: boolean;
  disabled?: boolean;
  onToggle: (channel: PublicationChannel) => void;
  onConfirm: () => void;
};

/**
 * Hints courts par channel — affichés sous le libellé pour aider le
 * DRH à choisir sans avoir besoin de relire la doc. Style identique à
 * CVRoutePicker (cohérence visuelle des pickers du chat).
 */
const CHANNEL_HINTS: Record<PublicationChannel, string> = {
  linkedin: 'Ton engageant, accroche enjeu, vouvoiement personnel',
  indeed: 'Factuel, ATS-ready, mots-clés métier',
  welcome_to_the_jungle: 'Storytelling, sections renommées culture',
  apec: 'Formel cadre, expérience et responsabilités',
  france_travail: 'Neutre, accessible, pré-requis explicites',
  generic: 'Annonce neutre diffusable partout',
};

const CHANNEL_ICONS: Record<
  PublicationChannel,
  typeof Globe
> = {
  linkedin: Sparkles,
  indeed: Newspaper,
  welcome_to_the_jungle: Sparkles,
  apec: Target,
  france_travail: Globe,
  generic: Globe,
};

export function PublicationChannelPicker({
  campaignId,
  selectedChannels,
  confirmed,
  disabled = false,
  onToggle,
  onConfirm,
}: PublicationChannelPickerProps) {
  const isLocked = confirmed || disabled;
  const selectedCount = selectedChannels.length;
  return (
    <div className="mt-2 grid gap-1.5">
      <p className="font-body text-[11px] text-stone-500 mb-1">
        Sélectionnez un ou plusieurs réseaux pour {campaignId}. Une
        annonce sera générée pour chacun.
      </p>
      {PUBLICATION_CHANNEL_ORDER.map((channel) => {
        const Icon = CHANNEL_ICONS[channel];
        const isSelected = selectedChannels.includes(channel);
        const clickable = !isLocked;
        return (
          <button
            key={channel}
            type="button"
            aria-pressed={isSelected}
            disabled={!clickable}
            onClick={() => clickable && onToggle(channel)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              !isLocked
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isSelected && !confirmed && 'border-emerald-400 bg-emerald-50',
              isSelected && confirmed && 'border-emerald-400 bg-emerald-50/70',
            )}
          >
            <span
              className={cn(
                'h-8 w-8 grid place-items-center rounded-lg shrink-0',
                isSelected
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-stone-100 text-stone-700 group-hover:bg-stone-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900">
                {PUBLICATION_CHANNEL_LABELS[channel]}
              </span>
              <span className="font-body text-[11.5px] text-stone-500 block leading-snug">
                {CHANNEL_HINTS[channel]}
              </span>
            </span>
            <span
              className={cn(
                'h-5 w-5 rounded-md border grid place-items-center shrink-0',
                'transition-colors',
                isSelected
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-stone-300 bg-white',
              )}
              aria-hidden
            >
              {isSelected ? (
                <Check className="h-3.5 w-3.5 text-white" />
              ) : null}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={isLocked || selectedCount === 0}
        onClick={() => !isLocked && selectedCount > 0 && onConfirm()}
        className={cn(
          'mt-1 w-full rounded-xl border px-3 py-2.5',
          'font-display font-semibold text-[13px] transition-all',
          isLocked
            ? 'border-stone-200 bg-stone-50 text-stone-500 cursor-not-allowed'
            : selectedCount === 0
              ? 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'
              : 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600',
        )}
      >
        {confirmed
          ? selectedCount === 1
            ? `Annonce ${PUBLICATION_CHANNEL_LABELS[selectedChannels[0]!]} en cours…`
            : `${selectedCount} annonces en cours…`
          : selectedCount === 0
            ? 'Sélectionnez au moins un réseau'
            : selectedCount === 1
              ? `Lancer une annonce ${PUBLICATION_CHANNEL_LABELS[selectedChannels[0]!]}`
              : `Lancer ${selectedCount} annonces`}
      </button>
    </div>
  );
}
