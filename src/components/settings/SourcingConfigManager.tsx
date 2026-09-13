'use client';

/**
 * Recherche de profils (module Sourcing) — interrupteur du cabinet.
 *
 * C'est le SECOND étage du flag : il ne fait apparaître l'onglet que si le
 * déploiement l'autorise déjà (variables d'environnement). L'écran le dit, pour
 * qu'un administrateur ne cherche pas pourquoi l'onglet reste absent.
 */

import { useState } from 'react';

import type { SourcingConfig } from '@/types/sourcing-settings';

export type SourcingConfigManagerProps = {
  config: SourcingConfig;
  onSave: (next: SourcingConfig) => void;
};

export function SourcingConfigManager({ config, onSave }: SourcingConfigManagerProps) {
  const [draft, setDraft] = useState<SourcingConfig>(config);
  const dirty =
    draft.enabled !== config.enabled ||
    draft.defaultLanguage !== config.defaultLanguage ||
    (draft.privacyContact ?? '') !== (config.privacyContact ?? '');

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <label className="flex items-start gap-3 font-body text-[13px] text-stone-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        <span>
          <span className="font-semibold text-stone-800">Activer la recherche de profils</span>
          <br />
          Les recruteurs interrogent un index de profils professionnels publics pour une campagne
          active, et approchent eux-mêmes les profils retenus. Rien n’est envoyé automatiquement.
        </span>
      </label>

      <div className="flex items-center gap-3 font-body text-[13px] text-stone-700">
        <span>Langue proposée par défaut</span>
        {(['fr', 'en'] as const).map((lang) => (
          <label key={lang} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="sourcing-default-language"
              checked={draft.defaultLanguage === lang}
              onChange={() => setDraft({ ...draft, defaultLanguage: lang })}
            />
            {lang === 'fr' ? 'Français' : 'Anglais'}
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 font-body text-[13px] text-stone-700">
        <span>Contact pour les données personnelles (délégué ou service)</span>
        <input
          type="text"
          value={draft.privacyContact ?? ''}
          placeholder="ex. dpo@cabinet.fr"
          onChange={(e) => setDraft({ ...draft, privacyContact: e.target.value.trim() === '' ? null : e.target.value })}
          className="max-w-sm rounded-md border border-stone-300 px-2 py-1 text-[13px]"
        />
        <span className="text-[12px] text-stone-500">
          Affiché aux personnes approchées. Vide : l’adresse de réception de la campagne.
        </span>
      </label>

      <p className="font-body text-[12px] text-stone-500">
        L’onglet « Sourcing » n’apparaît que si l’installation l’autorise aussi (configuration
        du déploiement). Le nombre de recherches et leur coût d’exploitation se suivent dans le
        tableau de bord d’administration.
      </p>

      <div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onSave(draft)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}
