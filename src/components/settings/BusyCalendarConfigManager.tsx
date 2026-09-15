'use client';

/**
 * Agenda externe des recruteurs — interrupteur du cabinet.
 *
 * SECOND étage du flag : il n'allume le connecteur que si le déploiement
 * l'autorise déjà (variables d'environnement) et que la relève périodique
 * tourne. L'écran le dit, pour qu'un administrateur n'allume pas une fonction
 * dont la surveillance n'est pas en place.
 */
import { useState } from 'react';

import type { BusyCalendarConfig } from '@/types/busy-calendar-settings';

export function BusyCalendarConfigManager({
  config,
  onSave,
}: {
  config: BusyCalendarConfig;
  onSave: (next: BusyCalendarConfig) => void;
}) {
  const [draft, setDraft] = useState<BusyCalendarConfig>(config);
  const dirty = draft.enabled !== config.enabled;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <label className="flex items-start gap-3 font-body text-[13px] text-stone-700">
        <input
          id="busy-calendar-enabled"
          type="checkbox"
          className="mt-0.5"
          checked={draft.enabled}
          onChange={(e) => setDraft({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-semibold text-stone-800">Tenir compte des agendas Outlook des recruteurs</span>
          <br />
          Chaque recruteur peut relier son agenda publié dans « Agendas &amp; disponibilités » : ses
          créneaux d’entretien n’y proposent plus les plages où il est déjà pris. Seuls les horaires
          occupés sont lus.
        </span>
      </label>

      <p className="font-body text-[12px] text-stone-500">
        Ne prend effet que si l’installation l’autorise ET que la relève automatique des agendas est en
        place (configuration du déploiement) : sans elle, un agenda qui ne se lit plus ne préviendrait
        personne. Éteindre remet en offre les plages occupées des recruteurs qui s’y fiaient — leur
        écran l’indique.
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
