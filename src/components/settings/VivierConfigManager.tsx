'use client';

/**
 * Réglages vivier (Session V3, §9) : mode de contact, template d'invitation,
 * cooldown, plafond de short-list, nom d'organisation. Édition en brouillon
 * local, sauvegarde explicite (le template est long, on évite un PUT par frappe).
 */

import { useState } from 'react';

import type { VivierConfig } from '@/types/vivier-settings';

export function VivierConfigManager({
  config,
  onSave,
}: {
  config: VivierConfig;
  onSave: (next: VivierConfig) => void;
}) {
  const [draft, setDraft] = useState<VivierConfig>(config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function set<K extends keyof VivierConfig>(key: K, value: VivierConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Mode de contact</span>
        <select
          value={draft.contactMode}
          onChange={(e) => set('contactMode', e.currentTarget.value as VivierConfig['contactMode'])}
          className="w-64 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
        >
          <option value="manual">Validation manuelle (défaut)</option>
          <option value="auto">Contact automatique</option>
        </select>
        <span className="text-[11px] text-stone-400">
          Manuel : l&apos;envoi suit votre acceptation. Auto : envoi après la
          présélection, dans la limite du plafond.
        </span>
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Cooldown (jours)</span>
          <input
            type="number"
            min={0}
            value={draft.cooldownDays}
            onChange={(e) => set('cooldownDays', Number(e.currentTarget.value))}
            className="w-32 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Plafond de short-list</span>
          <input
            type="number"
            min={1}
            value={draft.shortlistCap}
            onChange={(e) => set('shortlistCap', Number(e.currentTarget.value))}
            className="w-32 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">
            Seuil de pertinence
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={draft.similarityFloor}
            onChange={(e) => set('similarityFloor', Number(e.currentTarget.value))}
            className="w-32 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
          <span className="text-[11px] text-stone-400">
            0 à 1 — sous ce seuil, un candidat est écarté.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Organisation</span>
          <input
            type="text"
            value={draft.organisationName}
            onChange={(e) => set('organisationName', e.currentTarget.value)}
            placeholder="Nom affiché dans l’invitation"
            className="w-56 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Template du message d&apos;invitation
        </span>
        <textarea
          value={draft.invitationTemplate}
          onChange={(e) => set('invitationTemplate', e.currentTarget.value)}
          rows={9}
          className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-400">
          Variables : [prénom], [intitulé du poste], [référence] (l’ID campagne
          à quoter en objet — indispensable au rattachement), [nom de la
          campagne], [adresse de réception], [Organisation]. La mention RGPD est
          ajoutée automatiquement.
        </span>
      </label>

      <button
        type="button"
        onClick={() => onSave(draft)}
        disabled={!dirty}
        className="self-start rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Enregistrer les réglages vivier
      </button>
    </div>
  );
}
