'use client';

/**
 * Réglages des messages candidat d'entretien : lien d'agenda (org-level), nom
 * d'organisation et de recruteur, templates d'acceptation+invitation et de
 * refus. Édition en brouillon local, sauvegarde explicite (les templates sont
 * longs, on évite un PUT par frappe). Réplique de VivierConfigManager.
 */

import { useState } from 'react';

import type { InterviewConfig } from '@/types/interview-settings';

export function InterviewConfigManager({
  config,
  onSave,
}: {
  config: InterviewConfig;
  onSave: (next: InterviewConfig) => void;
}) {
  const [draft, setDraft] = useState<InterviewConfig>(config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const agendaMissing = draft.agendaLink.trim().length === 0;

  function set<K extends keyof InterviewConfig>(
    key: K,
    value: InterviewConfig[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Lien d&apos;agenda</span>
        <input
          type="url"
          value={draft.agendaLink}
          onChange={(e) => set('agendaLink', e.currentTarget.value)}
          placeholder="https://cal.com/votre-equipe/entretien"
          className="w-full rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-400">
          Lien Calendly / Cal.com sur lequel le candidat choisit lui-même son
          créneau. Injecté dans <code>[lien d&apos;agenda]</code>. Sans lui,
          l&apos;envoi d&apos;une acceptation est bloqué.
        </span>
        {agendaMissing ? (
          <span className="text-[11px] font-semibold text-amber-600">
            ⚠ Lien d&apos;agenda non configuré — les acceptations ne pourront
            pas être envoyées tant qu&apos;il est vide.
          </span>
        ) : null}
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Organisation</span>
          <input
            type="text"
            value={draft.organisationName}
            onChange={(e) => set('organisationName', e.currentTarget.value)}
            placeholder="Nom affiché dans les messages"
            className="w-56 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Nom du recruteur</span>
          <input
            type="text"
            value={draft.recruiterName}
            onChange={(e) => set('recruiterName', e.currentTarget.value)}
            placeholder="Signataire des messages"
            className="w-56 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Template du message d&apos;acceptation + invitation
        </span>
        <textarea
          value={draft.acceptanceTemplate}
          onChange={(e) => set('acceptanceTemplate', e.currentTarget.value)}
          rows={9}
          className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-400">
          Variables : [prénom], [nom], [intitulé du poste], [nom de la
          campagne], [organisation], [nom du recruteur], et{' '}
          <strong>[lien d&apos;agenda]</strong> (le candidat y choisit son
          créneau). Aucune date / heure / lieu / durée : le message ne contient
          pas d&apos;info de RDV.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Template du message de refus
        </span>
        <textarea
          value={draft.rejectionTemplate}
          onChange={(e) => set('rejectionTemplate', e.currentTarget.value)}
          rows={8}
          className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-400">
          Variables : [prénom], [nom], [intitulé du poste], [nom de la
          campagne], [organisation], [nom du recruteur]. Le motif interne
          d&apos;analyse n&apos;est jamais exposé au candidat.
        </span>
      </label>

      <button
        type="button"
        onClick={() => onSave(draft)}
        disabled={!dirty}
        className="self-start rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Enregistrer les réglages d&apos;entretien
      </button>
    </div>
  );
}
