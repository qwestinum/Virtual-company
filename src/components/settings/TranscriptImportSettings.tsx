'use client';

/**
 * Comptes rendus d'entretien — interrupteur de l'import de transcription.
 * Spec : docs/specs/compte-rendu-entretien.md §9, §14.4.
 *
 * Le texte ci-dessous est celui que le DPO doit lire AVANT d'activer : il
 * reprend mot pour mot l'information publiée dans
 * docs/ops/configuration-client.md §2. Éteint, le bouton d'import disparaît ;
 * le compte rendu reste rédigeable à la main.
 */

import { useState } from 'react';

import type { InterviewConfig } from '@/types/interview-settings';

export function TranscriptImportSettings({
  config,
  onSave,
}: {
  config: InterviewConfig;
  onSave: (next: InterviewConfig) => void;
}) {
  const [enabled, setEnabled] = useState(config.transcriptImportEnabled);
  const dirty = enabled !== config.transcriptImportEnabled;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <label className="flex items-start gap-3 font-body text-[13px] text-stone-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-stone-800">
            Autoriser l’import de transcription d’entretien
          </span>
          <br />
          Les recruteurs peuvent importer la transcription produite par leur outil de visio pour
          obtenir un compte rendu proposé, qu’ils vérifient avant de le valider. Désactivé, le
          compte rendu reste rédigeable à la main.
        </span>
      </label>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] text-amber-900">
        <p className="font-semibold">À lire par le DPO avant activation</p>
        <p className="mt-1">
          ORQA ne conserve aucune transcription : le texte est lu en mémoire, sert à proposer un
          compte rendu, puis est abandonné, y compris en cas d’échec. En revanche, le texte
          intégral transite par le fournisseur de modèle de langage configuré pour l’analyse des
          CV. Ce fournisseur peut le conserver jusqu’à 30 jours (détection d’abus), comme les CV
          — même fournisseur, même contrat de sous-traitance ; zéro avec un accord de
          non-conservation. Une transcription d’entretien est plus riche qu’un CV et plus exposée
          aux données sensibles. L’information et le consentement du candidat à l’enregistrement
          et à la transcription relèvent du client.
        </p>
      </div>

      <div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onSave({ ...config, transcriptImportEnabled: enabled })}
          className="rounded-lg bg-stone-900 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}
