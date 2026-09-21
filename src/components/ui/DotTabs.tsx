'use client';

/**
 * LES PUCES À POINT COLORÉ — extraites de `CampaignsList`, qui en était le
 * modèle, et désormais LE composant de bascule de vue du produit.
 *
 * ⚠️ RÈGLE (21/09/2026) : un écran ne crée JAMAIS son propre composant de
 * navigation ni son propre compteur. Il prend l'un des deux existants — ces
 * puces, ou les cartes-compteurs soulignées (`CounterRibbon`). Pilotage s'en
 * était fabriqué un troisième, une barre d'onglets segmentée qui n'existait
 * nulle part ailleurs ; on ne reconnaissait pas, d'un écran à l'autre, la
 * chose qui fait basculer de vue. Une garde structurelle
 * (`interface-sobre.test.ts`) refuse qu'une page en redéfinisse un.
 *
 * Le point coloré n'est pas un ornement : c'est le MÊME repère de couleur que
 * la pastille d'état d'une ligne et que le soulignement d'une carte-compteur.
 *
 * ⚠️ Aucune ombre sur la puce active — la sélection se marque par le fond
 * blanc, comme partout ailleurs. Le modèle d'origine portait un
 * `0 1px 4px rgba(0,0,0,0.06)` ; c'est le relief dont on sort.
 */

export type DotTab<K extends string> = {
  key: K;
  label: string;
  /** La couleur du point. Un repère, pas une décoration. */
  dot: string;
  /** Compte facultatif : une bascule de vue n'en a pas toujours un. */
  count?: number;
};

export function DotTabs<K extends string>({
  tabs,
  current,
  onChange,
  ariaLabel,
}: {
  tabs: readonly DotTab<K>[];
  current: K;
  onChange: (next: K) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        // ⚠️ `inline-flex` : le fond chaud doit ÉPOUSER les puces. En `flex`,
        // il s'étirait sur toute la largeur de la page et se lisait comme une
        // barre — ce dont on vient justement de sortir.
        display: 'inline-flex',
        gap: 3,
        padding: 3,
        background: 'var(--dash-warm)',
        borderRadius: 10,
        flexWrap: 'wrap',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-dot-tab={tab.key}
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className="font-body"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              background: active ? 'var(--dash-surface)' : 'transparent',
              color: active ? 'var(--dash-text)' : 'var(--dash-text-tertiary)',
              transition: 'all 0.15s',
            }}
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: '50%', background: tab.dot }}
            />
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className="font-data"
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: active ? 'var(--dash-blue-light)' : 'transparent',
                  color: active ? 'var(--dash-blue)' : 'inherit',
                }}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
