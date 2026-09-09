'use client';

/**
 * Réglages APEC du cabinet — ce qui ne change jamais d'une offre à l'autre.
 *
 * La ligne de partage avec le formulaire de publication est celle du type
 * `AdepConfig` : ici le cabinet (code NAF, description, convention), là-bas le
 * poste (contrat, lieu, salaire, expérience). Y figer une valeur « par poste »
 * ferait publier la mauvaise à la première offre qui sort de l'ordinaire.
 *
 * Les VALEURS PAR DÉFAUT sont l'exception assumée : elles ne décident rien,
 * elles pré-remplissent un champ que l'humain voit et peut changer sur chaque
 * offre.
 *
 * ⚠️ AUCUN SECRET ICI, et l'écran le dit. L'identifiant ATS et la clé Argon2
 * sont des variables d'environnement ; le numéro de dossier est chiffré sur la
 * fiche du recruteur. Un champ « mot de passe » dans un écran de réglages
 * inviterait à coller une clé de 342 caractères dans une colonne en clair.
 */

import { useState } from 'react';

import {
  SALAIRE_TEXTE_LABELS,
  STATUT_POSTE_CODES,
  STATUT_POSTE_LABELS,
  ZONE_DEPLACEMENT_CODES,
  ZONE_DEPLACEMENT_LABELS,
} from '@/lib/jobboards/adep/domains';
import {
  DEFAULT_ADEP_CONFIG,
  missingAdepSettings,
  type AdepConfig,
} from '@/types/adep-settings';

import { ApecConfigDefaults } from './ApecConfigDefaults';

const INPUT =
  'w-full rounded-md border border-stone-200 px-2 py-1.5 font-body text-[13px] text-stone-700 outline-none focus:border-emerald-400';

const NAF_SHAPE = /^[0-9]{4}[A-Z]$/;

export function ApecConfigManager({
  config,
  onSave,
}: {
  config: AdepConfig;
  onSave: (next: AdepConfig) => void;
}) {
  const [draft, setDraft] = useState<AdepConfig>(config ?? DEFAULT_ADEP_CONFIG);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  // Ce qui manque est dit ICI aussi, pas seulement dans le panneau de la
  // campagne : découvrir qu'un code NAF manque au moment de publier, après
  // avoir rempli douze champs, est le parcours qu'on cherche à éviter.
  const missing = missingAdepSettings(draft);
  const nafShapeKo = draft.nafCode.trim().length > 0 && !NAF_SHAPE.test(draft.nafCode.trim());
  const descLength = draft.organizationDescription.trim().length;

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <p className="rounded-md bg-stone-50 px-2.5 py-2 text-[12px] text-stone-600">
        Identifiants techniques (<code>ADEP_ATS_ID</code>, clé Argon2,{' '}
        <code>ADEP_WSDL_URL</code>) : variables d’environnement, jamais saisies
        ici. Le numéro de dossier Apec se renseigne <strong>par recruteur</strong>,
        sur sa fiche. Voir <code>docs/ops/apec-mise-en-service.md</code>.
      </p>

      {missing.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800">
          Publication impossible tant qu’il manque : {missing.join(', ')}.
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Code NAF du cabinet</span>
        <input
          className={INPUT}
          value={draft.nafCode}
          placeholder="7810Z"
          maxLength={5}
          onChange={(e) =>
            setDraft({ ...draft, nafCode: e.currentTarget.value.toUpperCase().trim() })
          }
        />
        <span className={`text-[11px] ${nafShapeKo ? 'text-rose-600' : 'text-stone-400'}`}>
          {nafShapeKo
            ? 'Format attendu : 4 chiffres et une lettre (ex. 7810Z).'
            : 'Obligatoire pour publier — l’Apec le refuse dans tout autre format (API_311).'}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Description de l’entreprise
        </span>
        <textarea
          className={`${INPUT} min-h-24`}
          value={draft.organizationDescription}
          maxLength={3000}
          onChange={(e) =>
            setDraft({ ...draft, organizationDescription: e.currentTarget.value })
          }
        />
        <span
          className={`text-[11px] ${descLength > 0 && descLength < 100 ? 'text-rose-600' : 'text-stone-400'}`}
        >
          {descLength < 100 ? `${descLength}/100 minimum` : `${descLength}/3000`} —
          texte de marque, repris sur chaque annonce.
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.displayLogo}
          onChange={(e) => setDraft({ ...draft, displayLogo: e.currentTarget.checked })}
        />
        <span className="text-stone-700">Afficher le logo du cabinet sur l’annonce</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">Mode de convention</span>
        <select
          className={INPUT}
          value={draft.clientMode}
          onChange={(e) =>
            setDraft({ ...draft, clientMode: e.currentTarget.value as AdepConfig['clientMode'] })
          }
        >
          <option value="self">Direct — le cabinet recrute pour lui-même</option>
          <option value="broker">Indirect — recrutement pour un client réel</option>
        </select>
        {draft.clientMode === 'broker' ? (
          <span className="text-[11px] text-amber-700">
            Le mode indirect n’est ouvert qu’aux conventions Apec Cabinets / ETT /
            PRISME : sans convention signée, l’Apec refuse l’offre (API_330). La
            saisie du client réel n’a pas encore de formulaire.
          </span>
        ) : (
          <span className="text-[11px] text-stone-400">
            En direct, aucune information de client réel ne doit partir (API_329).
          </span>
        )}
      </label>

      <ApecConfigDefaults
        draft={draft}
        onChange={setDraft}
        inputClass={INPUT}
        statusOptions={STATUT_POSTE_CODES.map((c) => ({
          code: c,
          label: STATUT_POSTE_LABELS[c] ?? c,
        }))}
        travelOptions={ZONE_DEPLACEMENT_CODES.map((c) => ({
          code: c,
          label: ZONE_DEPLACEMENT_LABELS[c] ?? c,
        }))}
        payLabels={SALAIRE_TEXTE_LABELS}
      />

      <div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onSave(draft)}
          className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
        >
          Enregistrer les réglages APEC
        </button>
      </div>
    </div>
  );
}
