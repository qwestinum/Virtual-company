'use client';

/**
 * Identité du cabinet sur les surfaces vues par le CANDIDAT : logo et couleur
 * d'accent des pages de réservation et des messages du module.
 *
 * Le NOM d'organisation n'est pas ici : il vit dans « Entretiens — messages
 * candidat », d'où il signe déjà les mails. En poser une seconde copie
 * donnerait deux vérités et un jour deux noms différents dans un même envoi.
 *
 * Tout est facultatif. Sans configuration, les pages gardent une apparence
 * sobre — jamais un cadre vide ni une couleur criarde par défaut.
 */

import { useState } from 'react';

import { DEFAULT_BRANDING_CONFIG, type BrandingConfig } from '@/types/branding';

const INPUT =
  'w-full rounded-md border border-stone-200 px-2 py-1.5 font-body text-[13px] text-stone-700 outline-none focus:border-emerald-400';

export function BrandingManager({
  config,
  organizationName,
  onSave,
}: {
  config: BrandingConfig;
  /** Nom effectif, en LECTURE : édité dans la section « Entretiens ». */
  organizationName: string | null;
  onSave: (next: BrandingConfig) => void;
}) {
  const [draft, setDraft] = useState<BrandingConfig>(config ?? DEFAULT_BRANDING_CONFIG);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <p className="rounded-md bg-stone-50 px-2.5 py-2 text-[12px] text-stone-600">
        Nom affiché aux candidats :{' '}
        <strong className="text-stone-800">
          {organizationName ?? 'non configuré'}
        </strong>{' '}
        — modifiable dans « Entretiens — messages candidat ».
      </p>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Logo (URL)</span>
        <input
          type="url"
          className={INPUT}
          value={draft.logoUrl ?? ''}
          placeholder="https://…/logo.png"
          onChange={(e) =>
            setDraft({ ...draft, logoUrl: e.currentTarget.value.trim() || null })
          }
        />
        <span className="text-[11px] text-stone-400">
          Affiché en tête des pages de réservation et des messages. L’URL doit
          être publiquement accessible : les clients de messagerie ne chargent
          rien qui demande une session.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Couleur d’accent</span>
        <span className="flex items-center gap-2">
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-stone-200"
            value={isHex(draft.accentColor) ? draft.accentColor! : '#2f6d7a'}
            onChange={(e) => setDraft({ ...draft, accentColor: e.currentTarget.value })}
          />
          <input
            className={INPUT}
            value={draft.accentColor ?? ''}
            placeholder="#2f6d7a"
            onChange={(e) =>
              setDraft({
                ...draft,
                accentColor: e.currentTarget.value.trim() || null,
              })
            }
          />
        </span>
        <span className="text-[11px] text-stone-400">
          Boutons et créneau sélectionné sur la page candidat. Vide = palette
          par défaut (qui gère aussi le mode sombre).
        </span>
      </label>

      {draft.logoUrl ? (
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
          <p className="text-[11.5px] font-semibold text-stone-500">Aperçu</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.logoUrl}
            alt=""
            className="mt-1 max-h-11 w-auto"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      ) : null}

      <div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onSave(draft)}
          className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
        >
          Enregistrer l’identité
        </button>
      </div>
    </div>
  );
}

function isHex(value: string | null): boolean {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
