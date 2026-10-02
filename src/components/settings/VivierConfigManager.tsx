'use client';

/**
 * Réglages vivier (Session V3, §9) : mode de contact, cooldown, plafond de
 * short-list, seuil, nom d'organisation. Brouillon local, sauvegarde explicite.
 *
 * Le texte de l'invitation à candidater vit dans « Modèles de messages »
 * (02/10/2026). Ce composant ne rend donc que SES champs, sans le modèle :
 * l'appelant les fusionne dans la configuration COURANTE — sinon enregistrer
 * le cooldown remettrait l'ancien texte d'invitation.
 */

import { useState } from 'react';

import { DEFAULT_VIVIER_CONFIG, type VivierConfig } from '@/types/vivier-settings';

export type VivierOwnFields = Omit<VivierConfig, 'invitationTemplate'>;

export function pickVivierOwnFields(c: VivierConfig): VivierOwnFields {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { invitationTemplate, ...own } = c;
  return own;
}

export function VivierConfigManager({
  config,
  onSave,
}: {
  config: VivierConfig;
  onSave: (fields: VivierOwnFields) => void;
}) {
  const [draft, setDraft] = useState<VivierOwnFields>(() => pickVivierOwnFields(config));
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickVivierOwnFields(config));

  function set<K extends keyof VivierOwnFields>(key: K, value: VivierOwnFields[K]) {
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
          <span className="font-semibold text-stone-700">Recrutés : exclus pendant (mois)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={draft.hiredCooldownMonths ?? DEFAULT_VIVIER_CONFIG.hiredCooldownMonths}
            onChange={(e) => set('hiredCooldownMonths', Number(e.currentTarget.value))}
            title="Un candidat désigné recruté à la clôture n’est plus proposé par le vivier pendant ce nombre de mois. 0 : jamais exclu."
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
