'use client';

/**
 * Les valeurs par défaut du formulaire de publication, et les deux textes
 * facultatifs du cabinet. Sous-composant d'`ApecConfigManager` (limite des
 * 200 lignes par fichier).
 *
 * Ces réglages ne DÉCIDENT rien : ils pré-remplissent un champ que l'humain
 * voit et peut changer sur chaque offre. C'est pour cela qu'ils ont leur place
 * ici alors que le contrat, le lieu ou le salaire n'en ont pas — ceux-là
 * partiraient tels quels et personne ne les relirait.
 */

import type { AdepConfig } from '@/types/adep-settings';

type Option = { code: string; label: string };

export function ApecConfigDefaults({
  draft,
  onChange,
  inputClass,
  statusOptions,
  travelOptions,
  payLabels,
}: {
  draft: AdepConfig;
  onChange: (next: AdepConfig) => void;
  inputClass: string;
  statusOptions: Option[];
  travelOptions: Option[];
  payLabels: Record<string, string>;
}) {
  return (
    <>
      <p className="font-body text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">
        Valeurs par défaut du formulaire
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Statut du poste</span>
          <select
            className={inputClass}
            value={draft.defaultStatusJob}
            onChange={(e) =>
              onChange({
                ...draft,
                defaultStatusJob: e.currentTarget.value as AdepConfig['defaultStatusJob'],
              })
            }
          >
            {statusOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Zone de déplacement</span>
          <select
            className={inputClass}
            value={draft.defaultTravelZone}
            onChange={(e) =>
              onChange({
                ...draft,
                defaultTravelZone: e.currentTarget.value as AdepConfig['defaultTravelZone'],
              })
            }
          >
            {travelOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-stone-700">Affichage du salaire</span>
          <select
            className={inputClass}
            value={draft.defaultDisplayedPay}
            onChange={(e) =>
              onChange({
                ...draft,
                defaultDisplayedPay: e.currentTarget
                  .value as AdepConfig['defaultDisplayedPay'],
              })
            }
          >
            {Object.entries(payLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Conseils aux candidats <span className="text-stone-400">(facultatif)</span>
        </span>
        <textarea
          className={`${inputClass} min-h-16`}
          value={draft.presentationDescription}
          maxLength={500}
          onChange={(e) =>
            onChange({ ...draft, presentationDescription: e.currentTarget.value })
          }
        />
        <span className="text-[11px] text-stone-400">
          {draft.presentationDescription.trim().length}/500
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Processus de recrutement <span className="text-stone-400">(facultatif)</span>
        </span>
        <textarea
          className={`${inputClass} min-h-16`}
          value={draft.recruitmentDescription}
          maxLength={500}
          onChange={(e) =>
            onChange({ ...draft, recruitmentDescription: e.currentTarget.value })
          }
        />
        <span className="text-[11px] text-stone-400">
          {draft.recruitmentDescription.trim().length}/500
        </span>
      </label>
    </>
  );
}
