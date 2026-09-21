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
 * ⚠️ Une exception a existé un jour et demi : un compte d'alerte en sous-texte
 * (« 1 à confirmer ») sur la première carte d'Entretiens. Ce qui mérite un
 * sous-texte mérite sa PROPRE CARTE — c'est un volume, il se compte. Une garde
 * structurelle (`interface-sobre.test.ts`) refuse qu'un troisième rang de
 * texte revienne.
 *
 * Le soulignement coloré de 3 px porte la couleur ; la sélection se marque par
 * la bordure et le fond.
 *
 * Le total non filtré s'écrit quand il diffère (« 5 sur 18 ») : un dossier
 * masqué par un filtre reste compté.
 */

import { DASH, SKINS, type ListSkin } from './list-skin';

export type CounterItem = {
  key: string;
  label: string;
  count: number;
  /** Total hors filtre — écrit seulement s'il diffère. */
  total?: number;
  /** Classe de la pastille et du soulignement (peau `orqa`). */
  dotClass?: string;
  /** Couleur de la pastille et du soulignement (peau `dash`). */
  color?: string;
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
            <span
              className={`mt-1.5 flex items-center gap-1.5 ${s.libelle}`}
              style={skin === 'dash' ? { color: DASH.secondaire } : undefined}
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${item.dotClass ?? ''}`}
                style={item.dotClass ? undefined : { background: teinte }}
              />
              {item.label}
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
