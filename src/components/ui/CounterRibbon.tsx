'use client';

/**
 * LE RUBAN DE COMPTEURS — extrait de `CandidaturesRibbon`, qui en était le
 * modèle, et partagé tel quel par Entretiens et Pilotage.
 *
 * UNE CARTE = UN CHIFFRE ET UN LIBELLÉ. Rien d'autre, jamais : pas d'icône,
 * pas d'ombre, pas de TROISIÈME LIGNE. Toutes les cartes d'un ruban ont donc
 * exactement la même structure et la même hauteur — une carte plus haute que
 * ses voisines attire l'œil sans rien dire de plus.
 *
 * ⚠️ La précision, quand il y en a une, tient DANS la deuxième ligne : une
 * pastille de compte poussée tout à droite, en face du libellé (« 1 à
 * confirmer », ambre, sous « Programmés »). C'est la pastille des onglets de
 * navigation (`CountBadge`), pas une troisième forme. Elle a d'abord été un
 * sous-texte — une troisième ligne, donc une carte plus haute que ses voisines
 * — puis une quatrième carte, ce qui promettait une quatrième vue. Une carte
 * sans précision n'affiche RIEN à droite et garde exactement la même hauteur :
 * aucune ligne n'est réservée.
 *
 * Le soulignement coloré de 3 px porte la couleur ; la sélection se marque par
 * la bordure et le fond.
 *
 * Le total non filtré s'écrit quand il diffère (« 5 sur 18 ») : un dossier
 * masqué par un filtre reste compté.
 */

import { CountBadge } from './CountBadge';
import { DASH, SKINS, type ListSkin } from './list-skin';

export type CounterItem = {
  key: string;
  label: string;
  /**
   * Le chiffre. ABSENT quand il n'y en a pas à montrer — une bascule de vue
   * n'en a pas toujours un, et le libellé avec son point coloré suffit. Le
   * rang n'est alors pas rendu, jamais réservé : les cartes d'un même ruban
   * gardent la même structure entre elles.
   */
  count?: number;
  /** Total hors filtre — écrit seulement s'il diffère. */
  total?: number;
  /** Classe de la pastille et du soulignement (peau `orqa`). */
  dotClass?: string;
  /** Couleur de la pastille et du soulignement (peau `dash`). */
  color?: string;
  /**
   * Précision en pastille, à droite de la deuxième ligne. TOUJOURS calculée
   * sur l'ensemble, jamais sur la vue filtrée : c'est une alerte, et un filtre
   * de confort ne masque jamais un dossier en souffrance.
   */
  alert?: number;
  /** Ce que la précision veut dire. Sans lui, le nombre ne dit rien. */
  alertLabel?: string;
};

export function CounterRibbon({
  items,
  active,
  onSelect,
  skin = 'dash',
}: {
  items: readonly CounterItem[];
  active: string | null;
  /** `null` quand on déselectionne — le ruban est un filtre, pas un onglet. */
  onSelect: (key: string | null) => void;
  skin?: ListSkin;
}) {
  const s = SKINS[skin];
  return (
    // ⚠️ GRILLE À COLONNES ÉGALES, quel que soit le nombre de compteurs :
    // trois cartes = trois tiers, huit cartes = huit huitièmes. En `flex`,
    // trois cartes s'étiraient sur 460 px chacune, puis — plafonnées — elles
    // laissaient un vide à droite. Une grille fait les deux à la fois.
    <div
      className="grid gap-2 pb-1"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const selected = active === item.key;
        const teinte = item.color ?? DASH.bordureForte;
        return (
          <button
            key={item.key}
            type="button"
            data-counter={item.key}
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : item.key)}
            className={`relative overflow-hidden px-4 py-3.5 text-left transition ${s.carte} ${
              selected && skin === 'orqa' ? s.carteSelection : ''
            }`}
            style={
              skin === 'dash'
                ? {
                    borderColor: selected ? teinte : DASH.bordure,
                    background: selected ? DASH.chaud : DASH.surface,
                  }
                : undefined
            }
          >
            {item.count === undefined ? null : (
            <span
              className={`block ${s.chiffre}`}
              style={skin === 'dash' ? { color: DASH.texte } : undefined}
            >
              {item.count}
              {item.total !== undefined && item.total !== item.count ? (
                <span
                  className="ml-1.5 font-body text-[12px] font-semibold"
                  style={{ color: DASH.secondaire }}
                >
                  sur {item.total}
                </span>
              ) : null}
            </span>
            )}
            {/* LIGNE 2 — le repère et le libellé à gauche, la précision tout à
                droite. `justify-between` : la pastille ne s'ajoute pas à la
                suite du libellé, elle s'aligne au bord. */}
            <span
              className={`mt-1.5 flex items-center justify-between gap-2 ${s.libelle}`}
              style={skin === 'dash' ? { color: DASH.secondaire } : undefined}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${item.dotClass ?? ''}`}
                  style={item.dotClass ? undefined : { background: teinte }}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.alert && item.alert > 0 ? (
                <CountBadge tone="waiting" title={`${item.alert} ${item.alertLabel ?? ''}`.trim()}>
                  {item.alert}
                  {item.alertLabel ? (
                    <span className="font-body font-semibold">{item.alertLabel}</span>
                  ) : null}
                </CountBadge>
              ) : null}
            </span>
            {/* Soulignement de 3 px : c'est LUI qui porte la couleur, pas un
                aplat — la teinte doit rester un repère, pas un fond. */}
            <span
              aria-hidden
              className={`absolute inset-x-0 bottom-0 h-[3px] opacity-85 ${item.dotClass ?? ''}`}
              style={item.dotClass ? undefined : { background: teinte }}
            />
          </button>
        );
      })}
    </div>
  );
}
