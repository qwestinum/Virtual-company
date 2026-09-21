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
  Toolbar,
  ToolbarReset,
  ToolbarSegment,
  ToolbarSelect,
} from '@/components/ui/Toolbar';
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
    // ⚠️ LA BARRE D'OUTILS PARTAGÉE : une seule rangée, des contrôles de même
    // hauteur. Le sélecteur et le raccourci vivaient côte à côte avec deux
    // hauteurs différentes — ce qui se lit comme deux rangées.
    <Toolbar>
      <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
        Référent :
        <ToolbarSelect
          ariaLabel="Filtrer par référent"
          testId="referent"
          value={selectedKey}
          onChange={(v) => {
            const next = options.find(
              (o) => referentSelectionKey(o.selection) === v,
            );
            onChange(next?.selection ?? ALL_REFERENTS);
          }}
        >
          {options.map((o) => (
            <option
              key={referentSelectionKey(o.selection)}
              value={referentSelectionKey(o.selection)}
            >
              {o.label} ({o.count})
            </option>
          ))}
        </ToolbarSelect>
      </label>

      {currentUserId && myCount > 0 ? (
        <ToolbarSegment
          active={isMine}
          onClick={() =>
            onChange(
              isMine ? ALL_REFERENTS : { kind: 'recruiter', id: currentUserId },
            )
          }
        >
          Mes campagnes ({myCount})
        </ToolbarSegment>
      ) : null}

      {isFiltered ? <ToolbarReset onClick={() => onChange(ALL_REFERENTS)} /> : null}
    </Toolbar>
  );
}
