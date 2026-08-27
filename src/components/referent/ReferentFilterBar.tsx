'use client';

/**
 * Barre de filtre « Référent » de la file des validations suspendues.
 *
 * COMMODITÉ DE LECTURE, jamais une restriction d'accès : tout reste
 * consultable et actionnable par tout le monde, le filtre ne fait que réduire
 * ce qui s'affiche. Il n'est PAS persisté (ni localStorage, ni URL) — un filtre
 * oublié qui masque des dossiers est pire que pas de filtre du tout.
 *
 * Le sélecteur est un `<select>` natif, comme le sélecteur « Recruteur
 * référent » de l'édition de campagne (cf. OwnerEditBlock) : même idiome,
 * accessible au clavier sans code.
 */

import {
  ALL_REFERENTS,
  referentSelectionKey,
  type ReferentOption,
  type ReferentSelection,
} from '@/lib/referent/filter';

export function ReferentFilterBar({
  options,
  selection,
  onChange,
  myCount,
  currentUserId,
}: {
  options: ReferentOption[];
  selection: ReferentSelection;
  onChange: (next: ReferentSelection) => void;
  /** Dossiers dont le référent est l'utilisateur connecté. 0 ⇒ pas de raccourci. */
  myCount: number;
  currentUserId: string | null;
}) {
  // Une seule entrée (« Tous ») = personne n'a de référent et il n'y a rien à
  // filtrer : la barre se retire plutôt que d'occuper la page pour rien.
  if (options.length <= 1) return null;

  const selectedKey = referentSelectionKey(selection);
  const isMine =
    selection.kind === 'recruiter' && selection.id === currentUserId;
  const isFiltered = selection.kind !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
        Référent :
        <select
          value={selectedKey}
          onChange={(e) => {
            const next = options.find(
              (o) =>
                referentSelectionKey(o.selection) === e.currentTarget.value,
            );
            onChange(next?.selection ?? ALL_REFERENTS);
          }}
          className="rounded-md border border-stone-300 bg-white px-2 py-1 font-body text-[12.5px] font-normal text-stone-800"
        >
          {options.map((o) => (
            <option
              key={referentSelectionKey(o.selection)}
              value={referentSelectionKey(o.selection)}
            >
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </label>

      {currentUserId && myCount > 0 ? (
        <button
          type="button"
          onClick={() =>
            onChange(
              isMine ? ALL_REFERENTS : { kind: 'recruiter', id: currentUserId },
            )
          }
          aria-pressed={isMine}
          className={`rounded-md border px-2.5 py-1 font-body text-[12px] font-semibold ${
            isMine
              ? 'border-stone-800 bg-stone-800 text-white'
              : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
          }`}
        >
          Mes campagnes ({myCount})
        </button>
      ) : null}

      {isFiltered ? (
        <button
          type="button"
          onClick={() => onChange(ALL_REFERENTS)}
          className="font-body text-[12px] font-semibold text-stone-500 hover:text-stone-800"
        >
          ✕ Réinitialiser
        </button>
      ) : null}
    </div>
  );
}
