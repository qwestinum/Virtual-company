'use client';

/**
 * Bloc de section pour la page /settings — PLIABLE.
 *
 * Repliée par défaut, une section montre son titre, son état en une ligne et,
 * le cas échéant, un signal d'attention. C'est le point : une liste de sections
 * qui ne dit rien de leur contenu remplace un mur par un autre — il faudrait
 * toutes les ouvrir pour savoir laquelle a besoin de vous.
 *
 * Le contenu n'est PAS monté tant que la section est fermée. Conséquence
 * voulue : les sections qui chargent des données (boîtes, recruteurs, sites…)
 * ne le font qu'à l'ouverture, au lieu de lancer une demi-douzaine d'appels au
 * chargement de la page.
 */

import { useId, type ReactNode } from 'react';

export type SectionStatus = 'ok' | 'warn' | 'neutral';

export type SettingsSectionProps = {
  icon: string;
  title: string;
  description: string;
  /** État courant en UNE ligne, lisible section repliée. */
  summary?: string | null;
  /** `warn` = quelque chose empêche le fonctionnement, visible replié. */
  status?: SectionStatus;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function SettingsSection({
  icon,
  title,
  description,
  summary,
  status = 'neutral',
  open,
  onToggle,
  children,
}: SettingsSectionProps) {
  const panelId = useId();
  return (
    <section
      className={`rounded-2xl border bg-white shadow-sm transition-colors ${
        status === 'warn'
          ? 'border-amber-300'
          : open
            ? 'border-stone-300'
            : 'border-stone-200'
      }`}
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start gap-3 rounded-2xl px-6 py-4 text-left hover:bg-stone-50"
        >
          <span aria-hidden className="mt-0.5 text-2xl leading-none">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-display text-[17px] font-bold text-stone-900">
                {title}
              </span>
              {status === 'warn' ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-body text-[11px] font-semibold text-amber-800">
                  à configurer
                </span>
              ) : null}
            </span>
            {/* Repliée : l'ÉTAT (ce qui est réglé). Dépliée : le RÔLE de la
                section — l'état est alors sous les yeux, le rappeler ne sert
                plus à rien. */}
            <span className="mt-1 block font-body text-[13px] text-stone-600">
              {!open && summary ? summary : description}
            </span>
          </span>
          <span
            aria-hidden
            className={`mt-1 shrink-0 text-stone-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          >
            ▾
          </span>
        </button>
      </h2>
      {open ? (
        <div id={panelId} className="flex flex-col gap-2 px-6 pb-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}
