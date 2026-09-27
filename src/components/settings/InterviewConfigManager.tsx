'use client';

/**
 * Réglages des messages candidat d'entretien : lien d'agenda (org-level), nom
 * d'organisation et de recruteur, templates d'acceptation+invitation et de
 * refus. Édition en brouillon local, sauvegarde explicite (les templates sont
 * longs, on évite un PUT par frappe). Réplique de VivierConfigManager.
 */

import { useState } from 'react';

import { AgendaLinkField } from '@/components/settings/AgendaLinkField';

import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';

export function InterviewConfigManager({
  config,
  onSave,
}: {
  config: InterviewConfig;
  onSave: (next: InterviewConfig) => void;
}) {
  const [draft, setDraft] = useState<InterviewConfig>(config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function set<K extends keyof InterviewConfig>(
    key: K,
    value: InterviewConfig[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <AgendaLinkField
        value={draft.agendaLink}
        onChange={(next) => set('agendaLink', next)}
      />

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

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Template du message de nouveau créneau
        </span>
        <textarea
          value={draft.rescheduleTemplate ?? DEFAULT_INTERVIEW_CONFIG.rescheduleTemplate}
          onChange={(e) => set('rescheduleTemplate', e.currentTarget.value)}
          rows={8}
          className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <span className="text-[11px] text-stone-400">
          Envoyé quand un rendez-vous déjà pris tombe : le cabinet décale, ou le
          candidat a annulé. Il ne réannonce PAS la sélection — le candidat l&apos;a
          déjà reçue. Variables : les mêmes, plus{' '}
          <code>[intro]</code> (la phrase de fait — qui a décalé et quand,
          rédigée automatiquement) et <code>[lien d&apos;agenda]</code>.
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
