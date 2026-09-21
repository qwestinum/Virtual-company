'use client';

/**
 * LA BARRE D'OUTILS — extraite de `CandidaturesFilters`, qui en était le modèle.
 *
 * UNE SEULE RANGÉE : recherche, listes déroulantes, puis à droite les
 * raccourcis. Pilotage portait à la place une carte blanche à trois étages
 * (recherche, puis donneur + tri, puis période) : trois fois la hauteur pour
 * les mêmes réglages, et un cadre qui n'existe sur aucun autre écran.
 *
 * Tous les contrôles ont la MÊME hauteur (40 px, celle des champs du produit) :
 * une rangée dont les boîtes ne s'alignent pas se lit comme deux rangées.
 *
 * ⚠️ Aucune ombre, aucun cadre autour de la barre : elle vit à même la page,
 * comme celle de Candidatures.
 */

import type { ReactNode } from 'react';

import { DASH, type ListSkin } from './list-skin';

/** 40 px : la hauteur des champs du produit (cf. `FIELD_BOX`). */
const BOITE = 'h-10 rounded-[10px] border bg-white px-3.5';

const POLICE: Record<ListSkin, string> = {
  orqa: 'font-inter text-[13.5px] text-orqa-encre',
  dash: 'font-body text-[13.5px]',
};

const BORDURE: Record<ListSkin, string> = {
  orqa: 'border-orqa-ligne',
  dash: '',
};

const styleBoite = (skin: ListSkin) =>
  skin === 'dash' ? { borderColor: DASH.bordure, color: DASH.texte } : undefined;

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

/** Le groupe poussé à droite (segments, raccourcis). */
export function ToolbarRight({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>;
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  skin = 'dash',
  className = 'min-w-[200px] max-w-[280px] flex-1',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  skin?: ListSkin;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={styleBoite(skin)}
      className={`orqa-field ${BOITE} ${BORDURE[skin]} ${POLICE[skin]} ${className}`}
    />
  );
}

export function ToolbarSelect({
  value,
  onChange,
  children,
  ariaLabel,
  testId,
  skin = 'dash',
}: {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
  ariaLabel: string;
  testId?: string;
  skin?: ListSkin;
}) {
  return (
    <select
      aria-label={ariaLabel}
      data-toolbar-select={testId}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={styleBoite(skin)}
      className={`orqa-field cursor-pointer ${BOITE} ${BORDURE[skin]} ${POLICE[skin]}`}
    >
      {children}
    </select>
  );
}

/** Raccourci à deux états (« Mes campagnes », « Issues du vivier »). */
export function ToolbarSegment({
  active,
  onClick,
  children,
  skin = 'dash',
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  skin?: ListSkin;
}) {
  const base = `rounded-full border px-3.5 py-2 transition ${
    skin === 'orqa' ? 'font-inter' : 'font-body'
  } text-[12.5px]`;
  if (skin === 'orqa') {
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`${base} ${
          active
            ? 'border-orqa-nuit bg-orqa-nuit text-white'
            : 'border-orqa-ligne bg-white text-orqa-gris hover:border-orqa-ciel hover:text-orqa-encre'
        }`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${base} font-semibold`}
      style={{
        borderColor: active ? DASH.texte : DASH.bordure,
        background: active ? DASH.texte : '#fff',
        color: active ? '#fff' : DASH.secondaire,
      }}
    >
      {children}
    </button>
  );
}

/** Lien discret de remise à zéro, en bout de barre. */
export function ToolbarReset({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-body text-[12px] font-semibold text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
    >
      Réinitialiser
    </button>
  );
}
