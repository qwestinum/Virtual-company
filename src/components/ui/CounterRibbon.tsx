'use client';

/**
 * LE RUBAN DE COMPTEURS — extrait de `CandidaturesRibbon`, qui en était le
 * modèle, et partagé tel quel par Entretiens et Pilotage.
 *
 * Une carte COMPACTE par compteur : le chiffre, le libellé avec sa pastille,
 * un soulignement coloré de 3 px. Sélection = bordure + fond. **Aucune icône,
 * aucune ombre** — les grandes tuiles à emoji et ombre portée qui l'avaient
 * remplacé un temps n'existaient sur aucun autre écran, créaient du vide et un
 * relief que rien ne porte ailleurs.
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
  /** Compte d'ALERTE, toujours sur l'ensemble, jamais sur la vue filtrée. */
  alert?: number;
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
    <div className="flex gap-2 overflow-x-auto pb-1">
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
            // ⚠️ `flex-1` SEUL étire les cartes sur toute la largeur : huit
            // compteurs donnent des cartes compactes, trois donnent trois
            // pavés de 460 px et le vide que le ruban devait supprimer. La
            // largeur est donc PLAFONNÉE — un ruban de trois se lit comme un
            // ruban de huit, et Candidatures (155 px par carte) ne bouge pas.
            className={`relative min-w-[120px] max-w-[200px] flex-1 overflow-hidden px-4 py-3.5 text-left transition ${s.carte} ${
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
              {item.alert && item.alert > 0 ? (
                <span
                  title={`${item.alert} en retard`}
                  className="ml-1.5 rounded-full px-1.5 align-middle font-data text-[11px] font-bold text-white"
                  style={{ background: 'var(--dash-orange)' }}
                >
                  {item.alert}
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
