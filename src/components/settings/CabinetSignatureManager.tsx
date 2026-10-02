'use client';

/**
 * Nom du cabinet et signataire des messages — section « Identité du cabinet »
 * (02/10/2026 ; ils vivaient avec l'agenda, dans « Entretiens »).
 *
 * Ils appartiennent au réglage `interviewConfig`, partagé avec l'agenda et les
 * modèles de messages : ce composant ne rend que SES deux champs, que
 * l'appelant fusionne dans la configuration COURANTE.
 */

import { useState } from 'react';

import type { InterviewConfig } from '@/types/interview-settings';

export type CabinetSignatureFields = Pick<InterviewConfig, 'organisationName' | 'recruiterName'>;

export function pickCabinetSignatureFields(c: InterviewConfig): CabinetSignatureFields {
  return { organisationName: c.organisationName, recruiterName: c.recruiterName };
}

const INPUT =
  'w-64 rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400';

export function CabinetSignatureManager({
  config,
  onSave,
}: {
  config: InterviewConfig;
  onSave: (fields: CabinetSignatureFields) => void;
}) {
  const [draft, setDraft] = useState<CabinetSignatureFields>(() =>
    pickCabinetSignatureFields(config),
  );
  const saved = pickCabinetSignatureFields(config);
  const dirty =
    draft.organisationName !== saved.organisationName ||
    draft.recruiterName !== saved.recruiterName;

  return (
    <div className="flex flex-col gap-3 font-body text-[13px]">
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Nom de l&apos;organisation</span>
          <input
            type="text"
            value={draft.organisationName}
            onChange={(e) => setDraft({ ...draft, organisationName: e.currentTarget.value })}
            placeholder="Nom affiché aux candidats"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Nom du recruteur</span>
          <input
            type="text"
            value={draft.recruiterName}
            onChange={(e) => setDraft({ ...draft, recruiterName: e.currentTarget.value })}
            placeholder="Signataire des messages"
            className={INPUT}
          />
        </label>
      </div>
      <span className="text-[11px] text-stone-500">
        Repris dans les messages au candidat ([organisation], [nom du recruteur]) et sur les
        pages de réservation.
      </span>
      <button
        type="button"
        onClick={() => onSave(draft)}
        disabled={!dirty}
        className="self-start rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Enregistrer le nom et le signataire
      </button>
    </div>
  );
}
